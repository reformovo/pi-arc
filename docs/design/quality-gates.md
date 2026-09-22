# 第 4 轮质量门禁设计

> 状态：设计证据，不是实现契约。规范性要求以 [`docs/pi-arc.md`](../pi-arc.md) 第 14 节为准。本轮不创建任何配置文件或 CI workflow。

## 1. 目标与原则

质量门禁必须让实现者在不访问真实模型、真实 provider、远程 game 数据或旧项目的情况下，验证 `pi-arc` 的静态质量、跨语言契约、失败语义和审计完整性。

门禁遵循以下规则：

1. 一个职责只有一个权威工具，避免 formatter/linter/type checker 互相改写或重复报错。
2. 所有 CI 检查只读；允许写入被忽略的依赖、临时目录和 coverage output，但运行结束后 tracked worktree 必须无变化。
3. 版本和 lockfile 是验证输入，不允许 CI 自行升级或重新求解依赖。
4. 高风险语义必须用显式场景测试验证，不能用 coverage 数字代替。
5. 下载数据和 Run artifacts 作为不可信输入验证，不作为源码 lint/typecheck。

## 2. 工具链基线

以下是第一个实现包必须使用的精确基线。升级必须作为独立、可审阅变更，同时更新两个 lockfile并重新运行全部 required checks。

| 类别 | 精确版本 | 依据 |
| --- | --- | --- |
| Node.js | `22.23.1` | 当前工作区可用，满足 Pi 的 `>=22.19.0` 要求 |
| npm | `10.9.8` | 与 Node 基线共同固定，写入 `packageManager` |
| Python | `3.12.9` | 旧 ARC 项目已验证且兼容固定 ARC 依赖；不采用未验证的 3.13/3.14 |
| uv | `0.8.12` | 当前工作区可用并已解析 VISTA/ARC lockfile |
| `@biomejs/biome` | `2.3.5` | Pi 0.86 当前基线 |
| `typescript` / `tsc` | `5.9.3` | Pi 0.86 当前基线；不使用 experimental `tsgo` 作为 required type gate |
| `@types/node` | `22.19.19` | 与 Pi 0.86 和 Node 22 对齐 |
| `pyright` | `1.1.413` | 旧 ARC 项目已验证的 npm CLI 版本 |
| `vitest` | `4.1.9` | Pi 0.86 当前基线 |
| `@vitest/coverage-v8` | `4.1.9` | 与 Vitest 精确同版本 |
| Ruff | `0.16.6` | 旧 `memo-arc` 已锁定的 Python gate 版本 |
| Pytest | `8.4.2` | VISTA lockfile 已解析版本 |
| pytest-cov | `7.0.0` | Python coverage runner；作为 direct dev dependency 固定 |
| coverage.py | `7.10.7` | Python branch/line 数据源；作为 direct dev dependency固定 |

`package.json` 中所有 direct dependency/devDependency 使用完整版本，不使用 `^`、`~`、tag 或 Git branch。Python direct dependencies同样精确固定；transitive resolution 由 lockfile 固定。

GitHub Actions 基线：

| Action | 完整 commit SHA | 标注版本 |
| --- | --- | --- |
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 |
| `actions/setup-node` | `820762786026740c76f36085b0efc47a31fe5020` | v7.0.0 |
| `actions/setup-python` | `a309ff8b426b58ec0e2a45f0f869d46889d02405` | v6.2.0 |
| `astral-sh/setup-uv` | `08807647e7069bb48b6ef5acd8ec9567f424441b` | v8.1.0 |

workflow 必须对每个 SHA 保留人类可读版本注释；禁止仅引用 `@main`、`@vN` 或 tag。

## 3. 工具职责

| 工具 | 唯一职责 | 明确不负责 |
| --- | --- | --- |
| Biome | TS/JS/JSON/JSONC format、lint、import organize | TypeScript 类型、Markdown/YAML、Python |
| Ruff | Python format、lint、import sort | Python 类型、测试、下载 game 文件 |
| `tsc` | TypeScript 类型和模块解析 | emit、format、lint |
| Pyright | Python 类型 | format、lint、运行时 validation |
| Vitest | TypeScript unit/contract/integration tests 与 V8 coverage | Python 测试、真实 provider eval |
| Pytest | Python unit/contract/integration tests | TypeScript 测试、真实 game 下载 |
| 自定义只读检查 | import boundary、lock/direct-pin、生成 drift、docs/traceability | 修改源码或生成正式产物 |

不引入 ESLint、Prettier、isort、Black、mypy 或第二套同职责工具。普通工具选择可逆且不存在架构 lock-in，因此不创建 ADR。

## 4. Biome 设计

- 只使用显式 includes：生产 TS、测试 TS、scripts，以及项目维护的 JSON/JSONC；`package-lock.json` 作为 npm 生成的 lockfile 排除出 formatter/linter，由 lock/manifests check 验证。
- 基于 recommended rules，额外将 explicit `any`、non-null assertion、未使用 import、Node built-in 非 `node:` 协议和危险 promise/async 模式设为 error。
- formatter 明确 `indentStyle: tab`、`indentWidth: 3`、`lineWidth: 120`，与 Pi 当前 TS 风格一致。
- `biome check --error-on-warnings .` 是 CI 命令；不得带 `--write`。
- `biome check --write .` 只由显式本地 `fix:biome` 脚本调用。
- suppression 必须落在最小行/规则范围并包含说明；自定义 suppression check 拒绝 blanket file suppression 和无理由 suppression。

## 5. Ruff 设计

- `target-version = "py312"`，formatter 使用默认四空格/双引号，`line-length = 100`。
- lint 选择 `E4`、`E7`、`E9`、`F`、`I`、`UP`、`B`、`SIM`、`RUF`、`ASYNC`；不使用 `ALL`，避免与 formatter/Pyright 重叠和无意义 churn。
- test-only exceptions 只能使用精确 per-file rule，例如 fixture 中允许 magic value；生产目录不允许 broad ignore。
- CI 分别运行 `ruff format --check` 和 `ruff check --no-fix`。
- 本地修复拆成 `fix:ruff-lint`（`ruff check --fix`）和 `fix:ruff-format`（`ruff format`），不藏在 `check`/`test`/prepare hook 内。

## 6. TypeScript strict 策略

`tsconfig` 必须至少包含：

- `target: ES2022`，`module/moduleResolution: NodeNext`，`noEmit: true`；
- `strict: true`；
- `noUncheckedIndexedAccess: true`；
- `exactOptionalPropertyTypes: true`；
- `noImplicitOverride: true`；
- `noImplicitReturns: true`；
- `noFallthroughCasesInSwitch: true`；
- `noUncheckedSideEffectImports: true`；
- `verbatimModuleSyntax: true`；
- `forceConsistentCasingInFileNames: true`；
- `skipLibCheck: true`，只跳过第三方 declaration 内部检查，不降低项目源码检查。

生产和测试 TS 均纳入同一 strict program。禁止通过 exclude 测试、`// @ts-nocheck`、wide `unknown as T` 或 generated declaration 掩盖协议问题。必要的边界 narrowing 由 runtime schema/类型守卫完成。

## 7. Python strict 策略

- Pyright `typeCheckingMode = "strict"`、`pythonVersion = "3.12"`，include 生产、测试和 scripts。
- 禁止 `type: ignore` 无 rule code、module-wide Pyright disable 和 broad `Any` 泄漏。
- `arcengine` 等第三方缺失类型必须包在窄 adapter 中，用本地 `Protocol` 或最小 stub 描述实际使用 surface；业务代码不直接扩散 untyped object。
- 测试 doubles 也必须满足同一 Protocol，不用 `SimpleNamespace` 逃避类型门禁。
- Pyright 由 npm-pinned CLI 运行，解释器和 import environment 指向 uv 创建的 Python 3.12.9 `.venv`。

## 8. import boundary

第一实现包必须为每个 tracked source path分配以下逻辑所有权，并让只读 architecture check验证依赖方向：

1. **domain**：只能依赖 domain 和标准纯类型/值；不得导入 Pi、Node I/O、CLI、persistence 或 transport。
2. **application/controller**：可依赖 domain 和声明的 ports；不得直接导入 provider、文件数据库或 Python process实现。
3. **protocol/ports**：只包含跨边界 schema、类型与纯 validation；不得依赖 adapters。
4. **adapters**：Pi/`pi-ai`、persistence、filesystem、clock/ID、Python sidecar分别实现 ports；adapter 之间不能绕过 application互调。
5. **composition/CLI/SDK**：唯一允许装配具体 adapters 的位置；CLI 不得成为 SDK 或 domain 的依赖。
6. **Python Environment adapter**：只通过版本化 wire protocol/fixtures 与 TypeScript 对齐；不得读取 Pi session、模型凭据或任意 artifact文件。

具体目录名在实现骨架 handoff 中机械映射到这些所有权，不得改变依赖方向。检查使用 TypeScript compiler API 与 Python `ast` 或等价无副作用分析，并包含“故意违规 fixture 必须失败”的自测试。

## 9. lockfile 与供应链

- 必须提交 `package-lock.json`（lockfile v3）和 `uv.lock`。
- Node 安装只用 `npm ci --ignore-scripts --no-audit --no-fund`；如某个依赖确需 lifecycle script，先单独审阅并改成 allowlisted显式步骤。
- Python 安装只用 `uv sync --locked --all-groups --python 3.12.9`；`uv lock --check` 必须通过。
- 自定义 direct-pin check拒绝 semver range、workspace floating range、Git branch、URL without digest 和未锁 tool version。
- required PR checks 不运行会受 registry 当前状态影响的 audit。`npm audit --omit=dev --audit-level=high` 和 Python vulnerability audit属于独立定时检查，报告漏洞但不让同一代码在不同时间随机失去可合并性。
- 每个依赖升级 PR 必须同时包含 lockfile、变更范围和全部 gate结果；禁止在业务 PR 中顺带刷新 lockfile。

## 10. 资产与排除

以下路径类别必须排除出 formatter/linter/type checker/test discovery：

- `node_modules`、`.venv`、build/dist、coverage、临时目录；
- npm/uv 生成的 lockfile（仍由 dependency gate 校验，禁止手工格式化）；
- fetched game cache、解包后的 game Python/metadata；
- Run artifact roots、Raw Frame archive、receipt cache、Pi session storage；
- 工具生成且由 source-of-truth校验的输出。

排除不等于忽略验证：

- game/cache 由 locator/version/digest/schema validator检查；
- Run artifacts 由 audit/conformance test检查；
- generated output 由 `generate --check` 等价命令在临时目录重建并比较；
- committed `tests/fixtures`、contract schemas、golden terminal/receipt records始终纳入格式、类型可读性和测试。

禁止使用 `**/data/**`、`**/fixtures/**` 等会误排除 contract evidence 的宽泛 pattern。

## 11. 测试分层

### 11.1 TypeScript unit

Vitest 覆盖 domain 状态转换、坐标、schema、controller gating、Pi adapter mapping、artifact/audit validation。时间、UUID、filesystem、Models 和 Environment 都通过受控边界注入。

### 11.2 Python unit

Pytest 覆盖 Environment instance identity、actionId 去重、base anchor、receipt/Raw Frame commit marker、同实例查询和冲突拒绝。使用确定性 fake Environment，不加载远程 game。

### 11.3 跨语言 contract

同一组 JSON fixtures 必须在 TS 和 Python 两端分别通过/拒绝。至少包含：初始 Observation、Action intent、complete/partial receipt、Turn commit、RESET retry_state、checkpoint、terminal、late Evidence 和 schema version mismatch。

### 11.4 offline integration

启动真实本地 TypeScript host + Python sidecar process，但只使用：

- Pi 的 faux/in-memory `Models` provider；
- 固定 scripted model responses；
- fake deterministic Environment；
- 临时 artifact root；
- fake/controlled clock 和 ID；
- 禁止外部 socket/fetch 的 network sentinel。

环境中删除所有已知 provider key/OAuth变量。测试必须先证明 network sentinel 能拦截一次故意访问，再运行 happy path、GAME_OVER/RESET/WIN、provider failure、crash-point、sidecar disconnect、Unknown Outcome 和 late result。

### 11.5 CLI smoke

CLI smoke 属于 offline integration：验证 stdout 只有 JSONL、stderr 诊断隔离、WIN/非成功/Unknown Outcome 分类可区分、artifact root可审计、secret sentinel 不泄漏。

## 12. coverage policy

| 范围 | line/statements | functions | branches |
| --- | ---: | ---: | ---: |
| TypeScript production | 90% | 90% | 85% |
| Python production | 90% | 不单列 | 85% |

Vitest V8 thresholds直接失败。Python 使用 coverage.py branch data 输出 JSON，再由只读 threshold checker分别检查 line 与 branch；不能只用一个混合 `fail-under`。

只排除不可执行的类型声明、明确生成的代码和平台防御分支。`pragma: no cover`/Vitest ignore 必须带理由并由 suppression check审核。以下关键状态不得排除，即使全局 coverage 已达标：

- Action intent 前/后、receipt 前/后、Turn commit 前/后；
- `play: never` 与 safe replay；
- RESET pending/activated retry_state；
- checkpoint partial/complete；
- same-instance reconnect 与 instance loss；
- archive corruption、terminal race 和 late result；
- same-response second `play` rejection。

## 13. 规范命令

实际 `package.json` scripts必须提供以下稳定入口；每个入口均为非交互、确定性和 source-read-only：

| Script | 必须执行的逻辑 |
| --- | --- |
| `check:dependencies` | direct-pin check、`uv lock --check`、lock/manifests一致性 |
| `check:format-lint` | `biome check --error-on-warnings .`、Ruff format check、Ruff lint no-fix、suppression check |
| `check:types` | `tsc --noEmit`、Pyright strict、import boundary check |
| `test:ts` | Vitest unit + TS coverage thresholds |
| `test:py` | Pytest unit + Python coverage JSON/thresholds |
| `test:contract` | TS/Python 对同一 fixture corpus 的双端测试及 schema drift check |
| `test:integration` | offline process integration、network/secret sentinel、CLI smoke |
| `check:spec` | Markdown link/table/whitespace、需求追踪、generated docs/schema check |
| `check` | 顺序组合以上所有门禁；不包含任何 fix、audit、下载或真实模型命令 |

本地修复命令必须单列为 `fix:biome`、`fix:ruff-lint`、`fix:ruff-format`。不定义自动运行的 pre-commit mutation；开发者可显式调用 `fix` 后再运行只读 `check`。

## 14. CI required checks

| Required check | 安装后执行 | 失败条件 |
| --- | --- | --- |
| `quality / dependencies` | `check:dependencies` | lock/manifests drift、非精确依赖、未批准 lifecycle |
| `quality / format-lint` | `check:format-lint` | 任一格式/lint/warning/suppression问题 |
| `quality / types-boundaries` | `check:types` | TS/Python 类型或 import boundary问题 |
| `test / typescript` | `test:ts` | 测试失败、coverage不足、flaky retry需求 |
| `test / python` | `test:py` | 测试失败、coverage不足、warning-as-error |
| `test / contract` | `test:contract` | 任一语言结果不同、schema/fixture drift |
| `test / integration-offline` | `test:integration` | 真实网络/secret访问、进程泄漏、场景/CLI失败 |
| `quality / specification` | `check:spec` + tracked diff check | 链接/表格/追踪/generated drift或工作树被改写 |

workflow 最小权限为 `contents: read`，`persist-credentials: false`，使用 concurrency cancel-in-progress 和每 job timeout。required jobs不读取 repository/environment secrets，不下载 game 数据，不上传含模型 transcript/secret 的 artifact。

Ubuntu 是规范 required runner。macOS arm64 的同一 offline suite必须在第一个业务逻辑 work package 获得验收前至少通过一次，并在具备稳定 runner后提升为 required；Windows 不属于 v1 已承诺平台。

## 15. 警告与 flaky policy

- 所有 linter warning、Python warning（除精确 allowlist）、unhandled rejection、resource warning 和测试 open handle均视为失败。
- CI 禁止自动 retry测试来掩盖 flaky；发现 flaky先隔离根因，不能用 sleep 或放宽 timeout作为默认修复。
- 测试超时只在单个测试上设置并解释；unit 默认应短，integration job有总 timeout。
- snapshot/golden 更新必须显式命令执行并人工审阅，CI只比较。
