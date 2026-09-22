# 第 4 轮评审记录：质量与验证设计

> 状态：已通过（2026-09-21）。本文是评审记录，不是实现契约。

## 本轮完成项

- 将第 3 轮标记为用户确认通过，并把 ADR 0001 标记为 `accepted`。
- 为 TypeScript、Python、跨语言协议、离线集成和规范文档确定互不重叠的质量工具职责。
- 提出精确工具版本、直接依赖固定、npm/uv lockfile 和 GitHub Actions SHA 固定策略。
- 定义 TypeScript/Python strict 类型策略、suppression 规则和跨层 import boundary。
- 设计 unit、contract、offline integration、CLI smoke、coverage 与故障场景门禁。
- 区分源码、committed fixtures、fetched game、generated output 和 Run artifacts 的检查方式。
- 固定八个 required check 名称，并建立 R-001 至 R-060 的验证映射。
- 保持 docs-only，没有创建源码、依赖、lockfile、工具配置、CI workflow、game 数据或 work package。

## 本轮核心提案

1. Biome 负责 TypeScript/JavaScript/JSON/JSONC 格式、lint 与 imports；Ruff 负责 Python 格式、lint 与 imports；`tsc`/Pyright 只做类型检查；Vitest/Pytest 只做测试与 coverage。
2. 固定 Node 22.23.1、npm 10.9.8、Python 3.12.9、uv 0.8.12，以及 `quality-gates.md` 所列工具精确版本；提交 `package-lock.json` 和 `uv.lock`，CI 仅执行 frozen install。
3. TypeScript 和 Python 的生产、测试与 scripts 均进入 strict 检查；suppression 必须最小、带具体规则和理由。
4. 自动检查 domain、application/controller、protocol/ports、adapters、composition/CLI/SDK 和 Python adapter 的依赖方向，并用故意违规 fixture 自测边界检查器。
5. 所有 required checks 只读；自动修复、snapshot/golden 更新与依赖求解只能由开发者显式发起。
6. offline integration 只使用 faux model、fake Environment、临时 artifact root、受控 clock/ID，并通过 sentinel 禁止真实网络和 secret 使用。
7. TypeScript production coverage 下限为 statements/lines/functions 90%、branches 85%；Python 为 lines 90%、branches 85%。第 3 轮高风险故障仍必须逐项显式测试，coverage 数字不能替代场景。
8. fetched/generated/frozen assets 不进入源码 lint/typecheck；game/cache、Run artifacts 和生成输出分别由 digest/schema/audit/drift validator 验证，committed contract fixtures 不得被宽泛排除。

## Required checks

1. `quality / dependencies`
2. `quality / format-lint`
3. `quality / types-boundaries`
4. `test / typescript`
5. `test / python`
6. `test / contract`
7. `test / integration-offline`
8. `quality / specification`

任一检查失败、跳过或超时都视为未通过。required checks 不访问真实模型、provider、远程 game 数据或 repository/environment secrets。

## 验证映射结论

- R-001 至 R-060 已分别映射到静态检查、自动化测试或人工审阅。
- Action replay、Unknown Outcome、terminal、sidecar、checkpoint 和 evidence integrity 等高风险要求都至少有一个自动化测试 ID。
- 第 5 轮仍须反向核对每个规范性 MUST/禁止项是否完整映射，并将验证 ID 分配给最终 work package；当前映射不等于 implementation handoff。

## 本轮没有作出的决定

- 没有创建 `package.json`、`pyproject.toml`、lockfile、Biome/Ruff/Pyright/TypeScript/Vitest/Pytest 配置或 CI workflow。
- 没有确定源码目录名、测试文件名、脚本实现或 architecture checker 的内部实现。
- 没有安装工具，也没有以新项目安装结果验证 pytest-cov/coverage.py 等版本；本轮固定的是设计基线，实际安装验证属于第一个 implementation work package。
- 没有选择 game 权威数据源、缓存布局或 digest 算法。
- 没有关闭第 2、3 轮保留的 wire schema、CLI/SDK signature、sidecar transport 等 gated 项。
- 没有创建 implementation handoff 或 work package，也没有进入实际开发。

## 审阅结论

用户于 2026-09-21 确认审阅通过：

1. 接受工具职责、精确版本和 npm/uv lock/frozen-install 策略；
2. 接受 TypeScript/Python strict、import boundary 和 suppression 规则；
3. 接受 unit/contract/offline integration、无真实模型/网络/secret 和 coverage 阈值；
4. 接受 fetched/generated/frozen asset 排除与 validator 策略；
5. 接受八个 required checks、只读 CI 和规范验证映射；
6. 批准进入第 5 轮最终反向审阅。
