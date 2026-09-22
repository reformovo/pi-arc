# 需求与证据追踪

> 状态：持续更新的设计证据，不是实现契约。本表说明需求来自哪里、当前有什么证据、在哪一轮形成规范；第 5 轮提案在用户审阅前仍不得视为 accepted contract。

| ID | 需求或设计输入 | 来源 | 当前证据 | 状态 | 规范化轮次 |
| --- | --- | --- | --- | --- | --- |
| R-001 | 新建独立 sibling 项目 `pi-arc` | 用户明确要求 | 本 docs-only 仓库 | 已纳入过程与边界规范 | 第 1 轮边界 |
| R-002 | 设计先行，多轮评审后才开发 | 用户明确要求 | `docs/pi-arc.md` 的过程约束 | 已纳入过程规范 | 全过程 |
| R-003 | 规范文档全部使用中文 | 用户明确选择 | 本轮文档 | 已纳入过程规范 | 全过程 |
| R-004 | 设计期不写业务代码、工具配置，不迁移/删除旧项目 | 用户明确要求 | 本轮只创建文档 | 已纳入过程规范 | 全过程 |
| R-005 | 最终退役 `memo-arc`、`memo`、`pi-memo` | 用户明确要求 | 三仓库均无 commit，删除不可逆 | 保持 gated；等价性验收后由跨项目 ADR 和用户删除批准触发 | 第 1 轮非目标、最终验收 |
| R-006 | 历史研究文档保留，不重写实验数字和旧协议 | 用户明确要求 | `memo-docs` 历史文档与 ADR | 已纳入边界规范 | 第 1 轮边界 |
| R-007 | VISTA 作为行为参考，不作为运行时依赖 | 用户明确要求 | VISTA `63c8843` 及 prompt/tools/controller/recovery 哈希 | 已纳入边界与依赖规范 | 第 1、2、3 轮 |
| R-008 | v1 只做冻结本地 ARC 单局闭环 | 用户明确选择 | v1 范围与第 15.6 节 Game 来源 | 已纳入第 1、2、5 轮规范 | 第 1、2、5 轮 |
| R-009 | TypeScript 主体与 Python ARC environment 边界 | 用户明确选择 | 旧 `memo-arc` 环境适配和 ARC SDK 约束 | 已纳入第 1、2、3、5 轮规范 | 第 1、2、3、5 轮 |
| R-010 | 提供无头 CLI 与可复用 SDK | 用户明确选择 | 第 2 轮已固定可观察能力边界 | 已纳入第 2、5 轮规范 | 第 2、5 轮 |
| R-011 | Pi 0.86 稳定 AgentHarness v4 为 runtime 基线 | 用户在比较后选择 | Pi 根导出、稳定 lane/session surface | 已纳入规范；ADR 0002 accepted | 第 1、3、5 轮 |
| R-012 | Pico3 暂不采用 | 用户在比较后选择 | experimental export、`micro` 未随包发布 | 已纳入规范；ADR 0002 accepted | 第 5 轮 ADR |
| R-013 | 模型接入使用公开 `pi-ai` 配置边界 | 用户明确选择 | `@earendil-works/pi-ai` 公共 exports | 已纳入规范；ADR 0003 accepted | 第 2、5 轮 |
| R-014 | 保存每个环境响应的全部原始帧，并支持历史视觉证据 | 用户此前确认的 VISTA 核心闭环 | VISTA controller/render、旧 archive 实现 | 已纳入第 2、3 轮规范 | 第 2、3 轮 |
| R-015 | 提供 `play`、`history`、`inspect`、`read_pixels` 和 GUIDE/WORKING | 用户此前确认的 VISTA 核心闭环 | VISTA tools/dispatcher | 已纳入第 2 轮规范 | 第 2 轮 |
| R-016 | 每次 `play` 前后形成可见预测/核对闭环 | 用户此前确认的 VISTA 思路 | VISTA prompt | 已纳入第 1、2 轮规范 | 第 1、2 轮 |
| R-017 | RESET 必须携带 `retry_state` 并切换 context | 用户此前明确选择 | VISTA Codex tools/controller/recovery | 已纳入第 2、3 轮规范 | 第 2、3 轮 |
| R-018 | 显式 `save_compact_checkpoint` | 用户此前明确选择 | VISTA Codex tools/harness | 已纳入第 2、3 轮规范 | 第 2、3 轮 |
| R-019 | 面向模型的显示与工具坐标固定为 1024×1024，ACTION6 映射到 64×64 原始环境网格 | 用户最新明确选择 | VISTA Codex controller 已采用相同坐标空间和映射 | 已纳入第 2 轮规范 | 第 2 轮 |
| R-020 | 不实现旧 `pi-memo` 的跨运行经验继承和 ALFWorld 流水线 | 用户此前明确选择 | 旧项目与历史文档 | 明确排除出 v1 | 第 1 轮 |
| R-021 | `play` 不得因 runtime recovery 自动重放 | VISTA 非幂等原则、Pi replay 契约 | VISTA HTTP 策略；AgentHarness `replay` surface | 已纳入第 3 轮规范 | 第 3 轮 |
| R-022 | 未确认 Action 采用 Unknown Outcome fail-closed | 先前方案中的风险结论 | Pi 明确不保证 exactly-once；VISTA 将 unconfirmed play 视为硬错误 | 已纳入第 3 轮规范 | 第 3 轮 |
| R-023 | Biome/Ruff 分管格式与 lint，`tsc`/Pyright 分管类型 | 用户明确要求参考最佳实践 | Pi Biome 配置、旧项目 Ruff/Pyright 配置 | 已纳入第 4 轮规范 | 第 4 轮 |
| R-024 | CI 只读、自动修复显式执行、测试不得调用真实模型 | 用户要求门禁，现有研究安全边界 | Pi check 模式与旧项目离线测试 | 已纳入第 4 轮规范 | 第 4 轮 |
| R-025 | implementation handoff 前不得创建 work package | 用户明确要求参考 Pi 模式 | Pi normative spec/handoff/work-package 分层 | 已纳入过程规范 | 第 5 轮 |
| R-026 | 不迁移旧项目的 game 文件；新项目通过统一流程重新拉取所需数据集 | 用户最新明确选择 | `memo-arc` 的旧文件与哈希仅作为事实基线 | 已纳入第 2、4、5 轮规范 | 第 2、4、5 轮 |
| R-027 | 一个 v1 Run 只承载一个 Game，但可跨越多个 Level、Attempt 和模型上下文 | 第 1 轮领域分析 | VISTA controller 的 level/attempt/recovery 行为 | 已纳入第 1 轮规范 | 第 1 轮 |
| R-028 | Turn 只由确认执行的环境 Action 产生；初始 Observation 为 Turn 0 | 第 1 轮领域分析 | VISTA action log、history 和 frame 命名行为 | 已纳入第 1 轮规范 | 第 1、2 轮 |
| R-029 | GAME_OVER 结束当前 Attempt 而不结束 Run；RESET 开始同一 Level 的新 Attempt | VISTA 行为参考 | VISTA attempt history 与 RESET recovery 测试 | 已纳入第 1 轮规范 | 第 1、2、3 轮 |
| R-030 | WIN 结束 Game 和 Run；模型主动停止或环境失败不得被误记为 WIN | 第 1 轮目标分析 | VISTA termination reason 与 terminal handling | 已纳入第 1 轮规范 | 第 1、3 轮 |
| R-031 | 环境 Observation 是游戏状态权威；模型输出、GUIDE、WORKING 和 runtime session 均不是 | 第 1 轮信任边界分析 | VISTA controller 权威状态与 Pi session 能力边界 | 已纳入第 1 轮规范 | 第 1、3 轮 |
| R-032 | v1 不包含批量竞赛、跨 Run 经验继承、通用游戏框架或交互式 UI | 第 1 轮最小性分析 | 用户已确认单局目标与旧路线退役 | 已纳入第 1 轮规范 | 第 1 轮 |
| R-033 | 提供无头 CLI 单 Run 入口，机器输出、诊断、终止和 secret 脱敏语义稳定 | 用户明确要求无头 CLI；第 2 轮外部契约 | Pi JSONL/session 证据与 VISTA runner | 已纳入第 2 轮规范 | 第 2 轮 |
| R-034 | 提供不依赖 CLI 进程的可复用 SDK，暴露领域结果而非 Pi 私有 runtime 类型 | 用户明确要求 SDK；第 2 轮外部契约 | AgentHarness public boundary | 已纳入第 2 轮规范 | 第 2、3 轮 |
| R-035 | 使用公开 `pi-ai` Models/CredentialStore 配置模型和凭据；禁止命令行明文 secret | 用户明确选择公开 `pi-ai`；第 2 轮安全边界 | Pi 0.86 `Models`、`CredentialStore`、`AgentHarnessOptions` | 已纳入第 2 轮规范 | 第 2、4 轮 |
| R-036 | play、history、inspect、read_pixels、GUIDE/WORKING 和 checkpoint 具有稳定读写边界 | 用户确认 VISTA 核心闭环；第 2 轮外部契约 | VISTA `tools.py`/`dispatcher.py` | 已纳入第 2 轮规范 | 第 2、3 轮 |
| R-037 | 全部模型视觉/工具坐标固定 1024×1024，ACTION6 映射到 64×64，Raw Frame 全量归档 | 用户最新明确选择；VISTA 行为证据 | VISTA Codex controller/render/tests | 已纳入第 2 轮规范 | 第 2、3 轮 |
| R-038 | 每个 Run 必须产出可独立审计的 manifest、Environment records、Raw frames、Visual index、Action/runtime records、知识快照和终止索引 | 用户此前确认审计闭环；第 2 轮外部契约 | VISTA private/action/recovery/frame records | 已纳入第 2 轮规范 | 第 2、3、4 轮 |
| R-039 | Game 统一重新拉取或从已验证缓存恢复，旧项目副本不得隐式 fallback | 用户最新明确选择；第 2 轮数据边界 | 旧项目只作事实证据；第 5 轮 resolver contract | 已纳入第 2、4、5 轮规范 | 第 2、4、5 轮 |
| R-040 | 每个 CLI/SDK/tool 接口必须覆盖正常、拒绝和终止场景 | 用户设计先行要求；第 2 轮验收设计 | VISTA tests 与本轮场景表 | 已纳入第 2 轮规范 | 第 2、5 轮 |
| R-041 | 每个 Environment Action 必须经过 durable intent、Environment receipt、Turn commit；只有 Turn commit 构成完成 Evidence | 第 3 轮效果边界分析 | Pi intent/effect/settlement 与 VISTA action/frame records | 已纳入第 3 轮规范 | 第 3 轮 |
| R-042 | `play`（含 RESET）声明 `replay: never`；只有证明从未被接受时才允许首次提交，否则 Unknown Outcome fail-closed | VISTA 非幂等原则；Pi replay 契约 | Pi unsafe tool recovery、VISTA HTTP retry guard | 已纳入第 3 轮规范 | 第 3 轮 |
| R-043 | Recovery 只能在同一 Environment 实例与已提交 Turn anchor 匹配时继续；v1 不通过重放 Action 重建 Environment | 第 3 轮恢复分析 | AgentHarness durable session 不包含 ARC state | 已纳入第 3 轮规范 | 第 3 轮 |
| R-044 | 只读工具和带稳定 invocation/anchor 的替换式笔记/checkpoint 可以安全 replay | 第 3 轮工具分类 | AgentHarness stable invocation ID、memo 和 safe replay | 已纳入第 3 轮规范 | 第 3 轮 |
| R-045 | RESET 的 retry_state 先暂存，只有 RESET Turn commit 后才激活；Context Boundary 交付可重试但 RESET 不可重放 | 第 3 轮边界分析 | VISTA retry staging/recovery 行为 | 已纳入第 3 轮规范 | 第 3 轮 |
| R-046 | checkpoint 必须锚定已提交 Turn 并以完整 commit marker 生效；部分保存无效且不得解锁 play | 第 3 轮 checkpoint 分析 | VISTA checkpoint gate；Pi durable tool checkpoint 不是 effect completion | 已纳入第 3 轮规范 | 第 3 轮 |
| R-047 | Python sidecar 必须串行 Action、暴露实例身份和稳定 receipt；sidecar 丢失后不得自动重建非终局 Environment | 第 3 轮 sidecar 分析 | ARC Environment 权威状态仅驻留于具体实例 | 已纳入第 3 轮规范 | 第 3 轮 |
| R-048 | terminal record 一旦提交不可改写；迟到结果只能追加 post-termination Evidence，不能重开 Run 或将原终止分类改写为 WIN | 第 3 轮竞态分析 | Pi immutable result records；审计因果顺序要求 | 已纳入第 3 轮规范 | 第 3 轮 |
| R-049 | AgentHarness 负责 runtime durable operation；ARC controller 负责 Run/Turn、Environment exactly-once 风险和审计完整性 | 第 3 轮责任映射 | Pi 0.86 harness 明确不保证 external exactly-once | 已纳入第 3 轮规范 | 第 3、5 轮 |
| R-050 | ARC 工具按模型 source order 串行执行；每个 assistant response 最多执行一个 `play`，其后的调用拒绝并等待模型观察 | 第 3 轮并发分析 | AgentHarness v4 支持 `toolExecution: "sequential"`；第 2 轮要求模型先观察再 Action | 已纳入第 3 轮规范 | 第 3 轮 |
| R-051 | Biome/Ruff 分管格式与 lint，`tsc`/Pyright 分管类型，Vitest/Pytest 分管测试 | 用户明确要求；第 4 轮工具职责分析 | Pi/VISTA/旧项目现有配置 | 已纳入第 4 轮规范 | 第 4 轮 |
| R-052 | 固定工具链、直接依赖和 GitHub Actions；提交 npm/uv lockfile 并只用 frozen install | 第 4 轮可复现性分析 | Pi exact dev pins、npm lock；VISTA/旧项目 uv lock | 已纳入第 4 轮规范 | 第 4 轮 |
| R-053 | TypeScript 与 Python 对生产和测试代码采用 strict 类型策略，suppression 必须窄且有理由 | 第 4 轮静态分析设计 | Pi strict TS；旧项目 Pyright standard 的不足 | 已纳入第 4 轮规范 | 第 4 轮 |
| R-054 | CI 所有门禁只读，自动修复命令显式分离，并检测工作树 drift | 用户明确要求；第 4 轮 CI 设计 | Biome/Ruff check modes | 已纳入第 4 轮规范 | 第 4 轮 |
| R-055 | 单元、跨语言 contract 和 offline integration 测试不得访问真实模型/provider/远程数据 | 用户已确认无真实模型约束；第 4 轮测试设计 | Pi faux Models；VISTA fake Environment | 已纳入第 4 轮规范 | 第 4 轮 |
| R-056 | TS 90/85、Python 90/85 coverage 下限，并对关键故障场景要求显式测试 | 第 4 轮 coverage 设计 | Vitest v8 coverage；coverage.py branch measurement | 已纳入第 4 轮规范 | 第 4 轮 |
| R-057 | 自动强制 domain、Pi adapter、CLI/SDK、persistence、Python protocol 的 import boundary | 第 4 轮架构门禁分析 | TypeScript compiler/Python AST 可实现只读检查 | 已纳入第 4 轮规范 | 第 4 轮 |
| R-058 | fetched game、artifacts、generated/frozen assets 采用显式 include/exclude 和 drift/digest validator | 第 4 轮资产门禁分析 | Pi Biome includes；旧项目 data 风险 | 已纳入第 4 轮规范 | 第 4 轮 |
| R-059 | 八个稳定 required checks 覆盖依赖、静态、类型、测试、离线集成与规范 | 第 4 轮 CI 设计 | Pi SHA-pinned CI；本轮命令矩阵 | 已纳入第 4 轮规范 | 第 4 轮 |
| R-060 | 每个规范性 MUST/禁止项映射到自动化或人工验证，高风险规则不得仅人工审阅 | 用户设计先行目标；第 4 轮 verification matrix | requirements traceability、故障矩阵与第 5 轮新增 contract 验证 | 已纳入规范；第 5 轮反向核对通过 | 第 4、5 轮 |

## 追踪规则

1. 每个规范性 MUST 必须引用至少一个需求 ID。
2. 每个需求 ID 在 accepted 规范中必须变为“纳入”“明确拒绝”或“保持 gated”。
3. 设计证据文件只能支持决策，不能替代规范文本。
4. 实现开始后，每个 work package 必须列出它覆盖的规范章节、需求 ID 和验证场景。
5. 来源文件变化时先更新基线和影响分析，不能静默沿用旧哈希。
