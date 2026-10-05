---
status: accepted
design-round: 5
updated: 2026-09-22
accepted: 2026-09-22
---

# pi-arc v1 规范

本文件是 `pi-arc` 唯一的规范性行为文档。第 0 至第 5 轮均已通过，规范于 2026-09-22 被用户明确接受。实现仍须遵循单独的 accepted implementation handoff；规范接受本身不授权编码。

## 1. 当前规范状态

- 当前状态为 `accepted`，但本文件本身不是 implementation handoff。
- 第 0 轮已确认来源、版本和证据类别；第 1 轮已确认领域语言、目标和边界；第 2 轮已确认外部行为契约；第 3 轮已确认持久性与失败语义；第 4 轮已确认质量与验证门禁。
- 第 5 轮已完成反向审阅、遗留项处置和用户确认。
- 后续用户已确认 [ADR-0005](adr/0005-official-sdk-acquisition-trust.md)：信任官方 Game，允许官方 SDK 在独立获取进程中加载 Game code 并接触 ARC 下载凭据；正式 Run 的 offline sidecar 边界不变。
- 旧项目退役仍作为明确排除出首批实现的跨项目 gate，不影响 `pi-arc` v1 规范接受。

## 2. 设计过程约束

以下约束从当前阶段起生效：

1. 本文件是唯一规范；设计证据和评审记录必须显式标注非规范性质。[R-002、R-006]
2. 所有规范文档使用中文，Pi/VISTA 的 API、类型和协议标识保留原英文拼写。[R-003]
3. 设计阶段不得创建业务源码、依赖或质量工具配置，不得迁移或删除旧项目。[R-001、R-004]
4. 每一轮设计形成独立评审记录并暂停；未经用户确认不得进入下一轮。[R-002]
5. 未解决的内容必须标记为 open 或 gated，不得由未来实现者补猜。[R-002]
6. implementation handoff 只能引用 accepted 规范，并且不得新增规范没有决定的行为；规范接受前不得创建 work package。[R-025]

## 3. 已确认的设计输入

这些条目是后续规范化的输入，不等同于已经完整定义的契约：

- 建立独立 sibling 项目 `pi-arc`，先只维护设计文档。
- v1 聚焦冻结本地 ARC 单局，不延续 ALFWorld 或旧 `pi-memo` 的跨运行经验机制。
- 新项目不迁移旧项目中的 game 文件；未来实现必须按第 15.6 节从官方 public catalog 重新拉取或使用已验证 cache。[R-026、R-039]
- VISTA 是行为证据来源，不是运行时依赖或可直接复制的实现。
- Pi 0.86 稳定 `AgentHarness` v4 是 runtime 基线；Pico3 是已评估但未采用的 experimental 备选。[R-011、R-012]
- 模型接入固定使用公开 `pi-ai` API，不依赖 coding-agent 私有 `ModelRuntime`。[R-013]
- 产品表面包括无头 CLI、可复用 SDK、视觉/历史/笔记工具和完整审计；第 2 轮已经固定其可观察契约。[R-010、R-014、R-015、R-038]
- 面向模型的显示与工具坐标空间固定为 1024×1024，与当前 VISTA Codex 路径保持一致；ACTION6 到 64×64 原始环境网格的映射及证据语义在第 2 轮形成外部行为契约。
- 质量门禁使用 Biome、Ruff、`tsc`、Pyright、Vitest 和 Pytest；第 4 轮已经固定职责、版本和阈值。[R-023、R-051–R-056]

## 4. 领域语言

规范用语以根目录的 [`CONTEXT.md`](../CONTEXT.md) 为准。[R-027、R-028、R-029、R-030、R-031]

- `Run`、`Game`、`Level`、`Attempt` 和 `Turn` 表示不同层级，禁止把 Pi session、模型上下文、操作系统进程或单次 tool call 称为 Run。[R-027、R-028]
- `Action` 只指可能改变 ARC Environment 状态的命令；只读视觉、历史和笔记操作不是 Action。[R-028]
- `Observation` 是游戏状态的权威陈述；`Frame` 是其原始视觉证据，1024×1024 `Visual` 是从 Frame 派生的模型视图。[R-014、R-019、R-031]
- `RESET`、`Retry`、`Recovery`、`Compaction` 和 `Context Boundary` 必须保持各自含义，禁止互作同义词。[R-017、R-018、R-029]

## 5. v1 目标

`pi-arc` v1 的目标是提供一个基于 Pi runtime、可通过无头 CLI 使用且可作为 SDK 复用的 ARC 单局 agent host。它必须把一个重新拉取并验证的 Game 交给模型，在一个 Run 内协调模型、ARC Environment、视觉工具、笔记和审计，直到产生可核对的 Run Termination。[R-008、R-010、R-011、R-013、R-026、R-027]

v1 复用 VISTA 已验证的行为思想，但不依赖 VISTA 代码或旧项目资产。成功不是“进程退出码为零”，而是 Run 的输入、环境交互、终止原因和证据可以被独立核对。[R-007、R-014、R-016、R-031]

## 6. 可观察成功标准

以下场景在第 1 轮确定语义；第 2、3 轮已经补充外部契约和失败语义，第 5 轮关闭剩余公开 schema 与物理边界。

### 6.1 正常 Action

- Run 必须从所选 Game 的初始 Observation 建立，初始 Observation 记为 Turn 0，不计为 Action。[R-027、R-028]
- 每个确认执行的 Action 必须产生下一个 Turn，并与其权威 Observation、全部原始 Frame 和可审计 Evidence 关联。[R-014、R-028、R-031]
- 面向模型的 Visual 和坐标空间必须保持 1024×1024；ACTION6 与 64×64 原始环境网格的映射属于第 2 轮外部契约。[R-019]

### 6.2 被拒绝的输入

- 在提交给 ARC Environment 前被拒绝的非法输入不得创建新的 Turn 或 Attempt，也不得产生环境副作用；拒绝本身必须可观察。[R-028、R-031]
- 非 Action 工具禁止推进 Turn 或改变权威游戏状态。[R-015、R-028、R-031]

### 6.3 GAME_OVER 与 RESET

- GAME_OVER 必须结束当前 Attempt，但不得结束 Run 或 Game；此时同一 Level 只能通过 RESET 继续。[R-017、R-029]
- RESET 是 Action。成功 RESET 必须产生新的 Turn、开始同一 Level 的新 Attempt，并携带供新上下文继续所需的 `retry_state`。[R-017、R-028、R-029]
- RESET 形成 Context Boundary，但不创建新 Run 或新 Game。[R-017、R-027、R-029]

### 6.4 Level 完成与 WIN

- 完成中间 Level 必须保留同一 Run 和 Game，结束旧 Level 的 Attempt，并以返回的权威 Observation 进入下一 Level。[R-027、R-028、R-031]
- Level 边界必须保留 GUIDE；当前 WORKING 必须先作为 Evidence 归档，再从新 Level 的活动工作状态中移除。[R-014、R-027]
- WIN 必须同时结束当前 Attempt、Game 和 Run，并记为成功终止；WIN 后禁止再执行 Action。[R-030]

### 6.5 模型停止、运行时变化与环境异常

- 模型在 WIN 前主动停止时，Run 必须以非成功原因终止或进入规范明确允许的继续路径，禁止将其记为 WIN。[R-030]
- Compaction、模型 context 更换或 runtime Recovery 本身禁止创建 Turn、Attempt 或环境状态变化。[R-018、R-027、R-028]
- 环境异常必须被记录；若无法证明 Action 是否执行，必须分类为 Unknown Outcome，不得伪造 Observation 或成功状态；停止与恢复规则以第 12 节为准。[R-021、R-022、R-030、R-031]

## 7. 明确非目标

v1 不包含以下能力：[R-020、R-032]

- 批量运行、竞赛 scorecard、跨 Game 调度或排行榜流水线；
- 跨 Run 经验继承、自动提炼永久策略库或旧 `pi-memo` 记忆机制；
- ALFWorld 或其他非 ARC 环境，以及面向任意游戏的通用框架；
- 交互式 GUI、Web 服务、多用户协作或远程控制平面；
- 保证模型必然解出 Game，或把模型声称完成视为成功；
- fork、修改或复制 VISTA/Pi 的私有实现；
- 从 `memo-arc`、`memo` 或 `pi-memo` 迁移源码、game 文件或运行材料；
- 在设计期删除旧项目，或在规范接受前实现业务逻辑。

## 8. 责任边界

| 参与方 | 负责 | 不负责 |
| --- | --- | --- |
| `pi-arc` | Run 生命周期、外部工具行为、环境动作门控、1024×1024 Visual、Evidence 关联、终止分类、统一 game 数据获取与校验 | 求解策略正确性、伪造环境状态、改变 Pi/VISTA 源码 |
| Pi stable `AgentHarness` | 模型与 tool loop 的 runtime 能力、durable session、runtime 事件与恢复原语 | ARC Environment 权威状态、Action exactly-once、`pi-arc` 的业务终止判定 |
| 公开 `pi-ai` | 模型发现、provider 配置和模型请求的公共接入边界 | ARC 工具语义、凭据持久化策略、游戏状态 |
| Python ARC Environment | Game 数据解释、合法环境转移以及权威 Observation/Frame | 模型上下文、GUIDE/WORKING、Pi session、完整 Run 审计 |
| game 数据源 | 提供可定位的数据集内容和版本来源 | Run 执行、旧项目迁移、模型行为 |
| VISTA | 提供已验证行为和失败案例的设计证据 | 运行时依赖、规范权威、可直接复制的实现 |
| `memo-docs` | 保存跨项目研究历史和未来旧项目退役决策 | `pi-arc` 行为规范 |
| `memo-arc`、`memo`、`pi-memo` | 设计期只读的历史来源 | 新系统 runtime、game 数据供应或实现依赖 |

## 9. 信任边界

- ARC Environment 返回的 Observation 是游戏状态唯一权威；模型输出、GUIDE、WORKING、Pi session 和进程退出状态都不能覆盖它。[R-031]
- `pi-arc` 只有在 Action 与权威结果可以关联时，才能把下一 Turn 记为已确认；Pi 的 durable invocation 记录本身不构成环境完成证据。[R-021、R-022、R-028、R-031]
- 重新拉取的 game 数据必须在使用前通过第 15.6 节的来源与完整性校验；旧项目中的副本不能作为隐式回退。[R-026]
- VISTA 行为只有在被本规范明确采纳后才成为要求；VISTA 的类、模块和文件布局不是契约。[R-007]

## 10. 第 2 轮外部行为契约（已确认）

本节只规定调用者、模型和独立审阅者可观察的行为；不规定 TypeScript/Python 类、模块、进程拓扑或数据库实现。第 5 轮关闭项以第 15 节为准。[R-033–R-040]

### 10.1 无头 CLI

CLI 的主要入口是执行单个 Run 的 `run`，并提供 `resume` 与只读 `audit`；精确 command/flag 见第 15.4 节。`run` 的逻辑输入必须能够表达：

- 一个已解析的 `Game` 标识和数据集引用；
- 一个 `provider` + `modelId` 的模型身份；
- 一个用于保存本 Run Evidence 的 artifact root；
- 可选的 thinking level、Action budget 和 game-offline 模式。

CLI 不得从 `memo-arc`、`memo` 或 `pi-memo` 读取 game 文件。启动 Run 前必须完成数据解析、版本/摘要核对、模型发现和凭据可用性检查；这些前置检查失败时不得向 Environment 发送 Action。[R-026、R-033、R-039]

无头行为约定如下：

1. stdout 只输出机器可读的事件/最终结果流；stderr 承载诊断，不把诊断混入 JSONL。
2. 最后一条机器可读记录必须包含 `runId`、Game 引用、终止分类和 artifact root；成功终止只能由权威 `WIN` 产生。
3. 进程退出码 `0` 只表示 `WIN`。配置/数据/凭据拒绝、已知非成功终止、Unknown Outcome 和审计失败必须按第 15.4 节区分。
4. CLI 不得在没有显式用户选择的情况下自动重放可能已经提交的 `play`；运行中止后是否可继续由第 3 轮决定。[R-021、R-022]
5. stdout 事件中的 secret、完整 API key、OAuth token、Authorization header 和 provider 私有凭据必须被省略或稳定脱敏。[R-035、R-038]

### 10.2 可复用 SDK

SDK 必须提供不依赖 CLI 进程的以下能力边界：

- 创建一个新的 Run，输入 Game 数据引用、模型配置和 artifact root；
- 获取当前 Run 的只读状态、工具结果、终止分类和 Evidence 索引；
- 在调用者明确提供 `pi-ai` 模型集合和凭据边界时启动模型 tool loop；
- 将环境 Action、模型 runtime 事件和审计结果以领域语义返回，而不是泄漏 Pi 私有 `AgentHarness`/session 类型。

SDK 的返回必须区分：调用被拒绝、Run 已终止、Run 成功、Run 非成功终止和结果未知。SDK 不承诺 Action exactly-once，也不把 Pi `OperationResultRecord` 单独当作环境完成 Evidence。[R-034、R-040]

已有 artifact root 的恢复和已提交事件读取由第 15.5 节固定。任意跨进程 attach、非 durable 实时 callback 和调用者直接驱动单个工具明确不属于 v1。

### 10.3 模型配置与凭据

模型配置的最小公开身份是：

```text
provider: string
modelId: string
thinkingLevel: off | minimal | low | medium | high | xhigh | max（具体可用值由模型能力决定）
```

`pi-arc` 必须通过公开 `pi-ai` `Models` 边界解析模型、检查 provider 可用性并发起请求；不得依赖 coding-agent 私有 `ModelRuntime`。v1 不公开 timeout、provider retry、transport、cache retention、payload rewrite 或 provider-specific request option；模型请求使用传入 Models 与 AgentHarness 0.86 捕获的策略，manifest 记录可公开的模型身份和 runtime 版本。[R-011、R-012、R-013、R-035]

凭据规则：

- CLI 默认使用 `pi-ai` 的环境/已配置凭据；SDK 调用者必须把 `CredentialStore` 封装进传入的 Models，`pi-arc` 不单独接收 secret resolver。
- 不接受命令行明文 API key；stdin secret、外部 secret helper 和交互式 login 都不属于 v1。
- headless CLI 遇到缺失或不可用凭据必须在首个 Action 前拒绝，不得等待未声明的交互输入。
- 运行产物只能记录 provider、modelId、credential source label（若可安全公开）和非秘密配置；不得记录 secret 内容。[R-035、R-038]

### 10.4 模型工具协议

工具名称和可观察语义固定如下。所有工具输入都拒绝未声明字段；拒绝不推进 Turn、Attempt 或 Environment 状态。

| 工具 | 正常行为 | 拒绝行为 | 终止/边界行为 |
| --- | --- | --- | --- |
| `play` | 执行恰好一个当前可用的 Environment Action；返回新 Turn、状态、进度、可用 Action、该响应的全部 Frame 数量和最终 1024×1024 Visual；模型在看到结果前不得执行下一次 `play` | 非法 Action、缺少/多余字段、ACTION6 坐标越界、当前不可用 Action | `GAME_OVER` 结束 Attempt；成功 `RESET` 开始新 Attempt；`WIN` 终止 Run；未知结果不得伪造成功 |
| `inspect` | 从已归档 Turn/Frame 选择 Visual；可选区域按 1024×1024 坐标裁剪并使用无平滑放大 | Turn/Frame/region 不存在或越界、问题/视图数量超限 | 始终只读；不能在终止 Run 后产生新的 Environment Action |
| `read_pixels` | 在已归档 Visual 的矩形区域按等分中心采样，返回请求顺序的行字符串和本次局部 palette | region、rows/columns、Turn/Frame 或总采样数超限 | 始终只读；不解释颜色、不比较图像、不改变状态 |
| `history` | 返回 `attempts` 摘要或按 Turn 选择的 `events`；结果来自 Environment action records | view、范围或 limit 非法 | 始终只读；不得把模型 transcript 当作 Environment event |
| `read_guide` / `write_guide` | 读取或完整替换当前 Run 的 GUIDE；写入是幂等笔记操作 | 非法参数、空内容、超过限制 | 跨 Attempt/Level 延续；不改变 Environment |
| `read_working` / `write_working` | 读取或完整替换当前 Level 的 WORKING；写入是幂等笔记操作 | 非法参数、空内容、超过限制 | RESET 后可交付给新上下文；Level 进度前必须先归档，随后清除活动 WORKING |
| `save_compact_checkpoint` | 显式保存完整 GUIDE（或明确不更新）和当前 WORKING 的继续状态 | 未请求 checkpoint、缺失任一必需内容、重复/不完整保存 | 不改变 Game；完成后形成 Context Boundary 所需的 checkpoint Evidence |

工具输入 shape 固定如下；`?` 表示可省略，所有对象仍拒绝未声明字段：[R-015、R-036、R-040]

```text
play { action, x?, y?, retry_state? }
inspect { question, views: [{ label, turn, frame?, region? }] }
read_pixels { question, views: [{ label, turn, frame?, region, rows, columns }] }
history { view, start_turn?, end_turn?, limit? }
read_guide {}
write_guide { content }
read_working {}
write_working { content }
save_compact_checkpoint { guide, working_memory }
region { x, y, width, height }
```

`action` 只能是 `RESET`、`ACTION1` 至 `ACTION7`。ACTION6 必须且只能携带 1024×1024 的整数 `x`/`y`；RESET 必须且只能额外携带非空 `retry_state`；其他 Action 禁止坐标和 retry_state。`history.view` 只能是 `attempts` 或 `events`；`guide` 只能是完整替换字符串或表示沿用当前 GUIDE 的 `null`。region、turn、frame、rows、columns、limit 都必须是整数。

每个成功结果必须提供以下稳定 logical fields；实际 Pi content block 可以额外呈现文字或图像，但不得省略或改名：[R-014–R-018、R-036]

- `play`：`turn`、`attempt`、`level`、`state`、`levelsCompleted`、`winLevels`、`availableActions`、`frameCount`、`visualRef`、`observationDigest`；
- `inspect`：请求 `question` 与按请求顺序排列的 `{label,turn,frame,visualRef}`，以及对应 image content；
- `read_pixels`：一个本次调用共享的 RGB `palette`，以及按请求顺序排列的 `{label,turn,frame,rows}`；
- `history`：`attempts` 或 `events` 数据、实际范围和 `truncated`；
- GUIDE/WORKING 读写：完整 `content`、`version` 和 anchor；
- checkpoint：`checkpointId`、anchor、GUIDE/WORKING versions 和 commit digest。

v1 限制固定为：GUIDE 65,536 个 Unicode code point、WORKING/retry_state 16,384 个、history limit 1–128（默认 64）、inspect 每次最多 16 个视图、read_pixels 每次最多 64 个视图且总计最多 4096 个样本、问题 1024 个 code point、视图标签 128 个。超限必须结构化拒绝，不得截断。调整这些公开限制必须修改规范，不得由实现静默改变。[R-014、R-015、R-017、R-018]

`play` 的“先预测、后核对”是模型行为要求：系统提示必须要求模型在每次 `play` 前陈述可证伪的预期，工具结果必须包含足够的可见变化与状态信息让模型核对。预测文本属于模型 transcript，不冒充 Environment Evidence。[R-016、R-031]

### 10.5 坐标与视觉语义

- 所有面向模型的 Visual、`play` 的 ACTION6、`inspect` region 和 `read_pixels` region 使用同一个 1024×1024 整数坐标空间；原点在左上，x 向右、y 向下，合法坐标为 `0..1023`。
- ACTION6 的环境坐标按 `floor(displayCoordinate × 64 / 1024)` 映射到 `0..63`；因此每个 16×16 显示像素 bin 对应一个环境网格格点，1023 映射到 63。
- 每个 Environment Observation 返回的所有原始 Frame 都必须归档；最终 Frame 可作为模型默认 Visual，但不能替代其余原始 Frame。
- `inspect` 的区域裁剪不能跨越 Visual 边界；等比例放大使用确定性最近邻或等价无平滑规则。`read_pixels` 只能读取归档 Visual，不从模型截图或重新渲染的近似图采样。[R-014、R-019、R-036]

### 10.6 Run artifact 与审计最小集合

每个真正开始的 Run 都必须有可定位的 artifact root，至少包含以下逻辑产物；稳定路径和 schema 见第 15.7 节：

1. Run manifest：Run/Game/数据集引用、数据源版本与摘要、模型身份、Pi/`pi-ai` 版本、坐标语义、开始时间和配置的脱敏摘要；
2. Environment record：初始 Observation、每个已确认 Action、每个结果 Observation、状态/进度和 Turn/Attempt/Level 关联；
3. Raw frame archive：每个 Environment 响应的全部原始 Frame 及可验证顺序、尺寸和摘要；
4. Visual evidence index：初始/结果 Visual 及 inspect/read_pixels 的来源引用；
5. Action/effect log：请求、校验、提交/结果关联、拒绝和错误分类，不把未确认结果写成成功；
6. Model/runtime record：模型消息、工具调用和必要的 Pi runtime 事件，secret 脱敏；
7. Knowledge snapshots：GUIDE、WORKING、retry_state、checkpoint 和 Level 边界归档；
8. Terminal record 与 audit index：唯一终止分类、成功判定、Unknown Outcome 标记和产物完整性摘要。

独立审阅者只依赖这些产物和规范即可判断“是否 WIN”“哪些 Action 已确认”“是否存在 Unknown Outcome”；不能要求访问模型 provider 或旧项目工作树。[R-014、R-026、R-038、R-040]

### 10.7 Game 数据重新获取

Run 使用的 Game 必须由统一 resolver 按第 15.6 节从官方 public catalog 重新拉取或从已验证缓存恢复；旧项目副本不得作为隐式 fallback。Run manifest 必须记录可复现的 source locator、dataset version、game ID 和 content digest。[R-026、R-039]

### 10.8 本轮场景验收

| 场景 | 必须可观察的结果 |
| --- | --- |
| 合法 `play` | 一个 Action、一个新 Turn、关联 Observation/全部 Frame/Visual 和可用 Action |
| 非法 `play` | 结构化拒绝，无 Turn、无 Environment 副作用、可在事件流中定位 |
| `inspect`/`read_pixels`/history/notes | 结构化结果，状态不变，来源 Turn/Frame 明确 |
| GAME_OVER 后 RESET | RESET 作为新 Action 记录，产生新 Turn 和 Attempt，并交付 retry_state |
| WIN 后任意 Action | 结构化终止拒绝；最终 record 仍唯一标记 WIN |
| 模型缺凭据或 provider 不可用 | 首个 Action 前拒绝；不产生伪造 Observation 或 WIN |
| Environment 返回缺帧/坏帧 | 按第 12.8 节分类为 `evidence_incomplete` 或 Unknown Outcome，不能用 Visual 替代缺失 Raw Frame |
| 数据集摘要不匹配 | 启动拒绝；不得从旧项目副本静默回退 |

## 11. 第 2 轮遗留项的第 5 轮处理

第 2 轮保留的公开契约不得继续以隐式默认进入开发。第 5 轮按以下方式关闭：[R-033–R-040]

1. CLI command/flag、JSONL envelope、退出码和 SDK surface 由第 15.4、15.5 节固定。
2. `pi-ai` v1 只消费公开 `Models`/`CredentialStore` 已解析能力；交互式 OAuth、provider 私有 header 和任意 payload 改写明确排除在 v1 外，不再作为实现 gate。
3. Game 数据 locator、缓存、offline 和 digest 由第 15.6 节固定。
4. artifact 稳定入口、文件类别和 schema version 由第 15.7 节固定；未影响审计者的内部索引实现不是公开契约。
5. 质量工具版本、coverage、offline integration 和 required checks 已由第 14 节固定。

## 12. 第 3 轮持久性与失败语义（已确认）

### 12.1 Run 开始与 durable binding

数据、模型、凭据或 artifact root 的前置检查失败时，Run 尚未开始，只返回结构化启动拒绝。只有初始 Environment Observation、全部初始 Raw Frame 和以下逻辑 binding 均已持久化后，Run 才进入 active：[R-038、R-041、R-043]

- `runId` 与 Game/data digest；
- Pi session/lane identity；
- 唯一 `environmentInstanceId`；
- 当前已提交 Turn、Observation digest、Attempt 和 Level anchor；
- 当前 active/terminal generation。

记录文件、schema family 与公共 JSON 约定见第 15.3、15.7 节。Pi session durable 不等于 Environment durable；缺少匹配的 Environment authority 时不得仅凭 session transcript 继续 Action。[R-031、R-043、R-049]

### 12.2 Action 的三段完成证据

每个 `play`（包括 RESET）使用稳定、Run 内唯一的 `actionId`，并严格串行执行；任一时刻最多有一个尚未完成的 Environment Action。[R-041、R-042]

ARC 工具必须按 assistant response 中的 source order 串行执行。每个 assistant response 最多允许一个 `play` 进入 Environment；一旦该 `play` 开始处理，后续 tool call 全部以 `observation_required` 拒绝且不产生副作用，模型必须先观察 `play` 结果再发起任何新工具调用。这要求 stable AgentHarness 使用其公开的 sequential tool execution 能力，不能沿用默认 parallel 模式。[R-016、R-050]

1. **Action intent**：在调用 Environment 前持久化 `actionId`、当前 `environmentInstanceId`、base Turn/Observation digest、请求参数和对应 Pi invocation identity。intent 只证明“准备提交”，不证明 Environment 收到或执行。
2. **Environment receipt**：同一 Environment 实例处理 Action 后，先持久化带 `actionId` 的权威 Observation、状态/进度、全部 Raw Frame 及其顺序和摘要，再发布完成 receipt。receipt 必须能按 `actionId` 查询；部分帧或未完成 marker 不构成 receipt。
3. **Turn commit**：ARC controller 校验 receipt 的实例、base Turn、Action、Observation 和全部 Frame 后，持久化唯一 Turn commit，并更新 Run binding。只有 Turn commit 构成“Action 已完成”的规范 Evidence，之后才能把最终工具结果交给模型或允许下一个 `play`。

若 receipt 已完成而 controller/Pi tool result 尚未结算，Recovery 必须从 receipt 完成 Turn commit 或读取既有 Turn commit，绝不能再次执行 Action。若 Turn commit 已完成而 Pi 仍把 `play` 视为中断，下一模型上下文必须在执行任何新 Action 前收到精确的最后 Action/Observation recovery envelope。[R-041、R-049]

### 12.3 replay 分类与 Unknown Outcome

| 工具/效果 | replay 分类 | 规则 |
| --- | --- | --- |
| `play`，包括 RESET | `never` | runtime recovery、provider retry、进程重启均不得自动重发 |
| `history`、`inspect`、`read_pixels`、`read_guide`、`read_working` | `safe` | 只从已提交 Evidence/笔记读取；同参数重放不改变 Game |
| `write_guide`、`write_working` | `safe` 的条件式完整替换 | 使用稳定 invocation identity 和预期 Turn/内容版本；相同 invocation 返回既有结果，anchor 冲突则拒绝，不覆盖更新内容 |
| `save_compact_checkpoint` | `safe` 的条件式提交 | 使用稳定 invocation identity 和 checkpoint anchor；重复提交同一内容返回既有 commit，anchor/内容冲突则拒绝 |
| 模型 provider request | 由 AgentHarness captured retry policy 管理 | 不直接改变 Environment；未完整结算的 tool call 不得执行 |

上述 safe replay 都必须满足 stable invocation、参数和 anchor 条件；它们不是 Retry，也不能扩大为 `play` 的 replay 权限。[R-044]

Action intent 已存在但没有 Turn commit 时，controller 只能向同一 `environmentInstanceId` 查询该 `actionId`：[R-021、R-022、R-042]

- 查到完整 receipt：完成 Turn commit，不重发 Action；
- 同一实例能权威证明该 `actionId` 从未被接受，且 base anchor 未变化：允许执行首次提交；这不是 replay；
- 查询超时、实例丢失、状态矛盾、只存在部分 receipt 或无法证明是否接受：立即分类为 Unknown Outcome，fail-closed 终止 Run；
- Unknown Outcome 后禁止任何新 Action、RESET、自动重建或 Action-log replay。

### 12.4 Recovery 的允许条件

Recovery 只有同时满足以下条件才能继续 active Run：[R-043、R-047、R-049]

1. artifact 中不存在 terminal record；
2. Pi session/lane 可附着，或可以建立受审计的新模型 Context；
3. 原 `environmentInstanceId` 仍存活并返回与最后 Turn commit 相同的 Turn/Observation digest；
4. 不存在未解决的 Action intent；若存在，必须先按 12.3 完成 reconciliation；
5. 已提交 Evidence、GUIDE/WORKING 和 checkpoint anchor 无矛盾。

v1 不通过从 Turn 0 重放 Action 日志来重建 Environment。Environment 实例丢失且没有 pending Action 时，以已知非成功原因 `environment_lost` 终止；若丢失时 Action 可能在途，则以 Unknown Outcome 终止。若最后已提交 Turn 是 WIN，可在不恢复 Environment 的情况下完成最终审计和成功终止。[R-030、R-043、R-047]

`AgentHarness.create()` 返回的 open operation 只构成 runtime inventory；ARC controller 完成上述一致性检查前不得调用 `drive()`/`resume()` 触发新的模型或工具效果。[R-011、R-049]

### 12.5 模型请求与模型停止

- 模型请求 intent 前故障不会改变 Environment；可以按同一运行配置重新请求。
- provider stream 在 intent 后、结算前中断时，允许 AgentHarness 按其稳定语义保存 partial frame、合成中断响应并在 captured retry policy 内重试；partial tool call 禁止执行。[R-011、R-049]
- provider retry 耗尽或配置不可用时，以已知非成功 `model_failure` 终止；不得改变最后已提交 Turn。
- 模型在 Environment 非终局时正常停止且未调用工具，host 在同一 Environment anchor 上最多执行一次显式 nonterminal continuation；若仍无 Action，则形成新的 Context Boundary 并交付一次 recovery envelope；新 Context 再次无进展时，以 `model_no_progress` 终止。任何 continuation/recovery 都不得推进 Turn。[R-030、R-043]
- 模型请求或文本在 terminal record 后迟到，只能进入 post-termination runtime Evidence，禁止触发工具。

### 12.6 RESET 与 Context Boundary

RESET 仍遵循普通 Action 三段协议，并始终 `replay: never`。`retry_state` 必须与 Action intent 在同一个 logical commit 中保存为 pending knowledge，不得提前或单独覆盖 active WORKING：[R-017、R-029、R-045]

- RESET 被拒绝或证明从未提交：删除 pending retry_state，保留原 WORKING；
- RESET Unknown Outcome：保留 pending retry_state 作为审计 Evidence，但不得激活，Run fail-closed；
- RESET Turn commit 完成：原 Attempt 结束，pending retry_state 原子地成为新 Attempt 的 active WORKING，并建立待交付 Context Boundary；
- Context Boundary delivery 中断可以用同一个 committed reset envelope 重试；不得再次 RESET；
- boundary 未交付期间禁止任何模型 Action，但 Environment 状态保持已确认。

### 12.7 checkpoint 与 Compaction

checkpoint anchor 至少包含 `runId`、`environmentInstanceId`、最后 Turn commit、Observation digest、Attempt/Level 和知识版本。checkpoint request 一旦生效，除 `save_compact_checkpoint` 外的模型工具全部拒绝，直到 checkpoint commit、明确取消或 Run 终止。[R-018、R-046]

- checkpoint commit 必须原子引用完整 GUIDE snapshot（或明确沿用版本）、非空 WORKING、anchor 和内容摘要；只有 commit marker 使其生效。
- 部分写入、缺失 marker、anchor 已变化或内容冲突一律视为无效 checkpoint，不得解锁 `play`。
- 同一 anchor 上 runtime 中断后，可用稳定 invocation identity 重试 checkpoint 保存；已经提交的相同 checkpoint 直接返回成功。
- checkpoint 已提交但 Context Boundary delivery 中断时，可重复交付同一 recovery envelope，不改变 Game。
- 若上下文容量或 runtime 状态已无法产生有效 checkpoint，以 `checkpoint_failed` 终止；这是已知状态失败，不是 Unknown Outcome。

Pi tool progress checkpoint 只是在 `effect_pending` 时保存的辅助进度，不等于上述 ARC checkpoint commit，也不构成 Environment Action 完成 Evidence。[R-046、R-049]

### 12.8 Python sidecar 与 Evidence archive

Python sidecar 作为 Environment authority adapter，必须：[R-009、R-041、R-047]

- 为每次启动生成唯一 `environmentInstanceId`，并拒绝其他实例的 Action；
- 串行处理 Action，校验 actionId、base Turn 和 Observation digest；
- 对同一实例内重复查询/投递的同一 actionId 返回已存在的 receipt，绝不二次调用 Environment；冲突参数必须拒绝；
- 在对 controller 报告完成前，先完成 Environment receipt 和全部 Raw Frame 的 durable commit；
- 支持读取当前 anchor 和按 actionId 查询 receipt，但不得提供绕过 controller 的任意 Action 通道。

sidecar 断开时：无 pending Action 则可在有界时间内尝试重连同一实例；实例身份变化或无法恢复时按 `environment_lost` 终止。有 pending Action 时必须先查询同一实例；无法查询即 Unknown Outcome。新 sidecar 实例不得继承旧实例 identity，也不得靠 replay 继续 active Run。[R-043、R-047]

Raw Frame/receipt 在 Turn commit 前缺失或损坏时，可从仍存活的同一 Environment 实例 response cache 修复；无法修复则不得提交 Turn，并按 Action 是否可确认分类为 Unknown Outcome 或 `evidence_incomplete`。Turn commit 后发现摘要不匹配时，立即停止新 Action 并以 `evidence_corrupt` 终止；若 Run 已终止，则追加 audit finding，不改写历史 terminal record。[R-038、R-048]

### 12.9 terminal record 与迟到结果

terminal record 必须唯一、持久且不可改写；提交前先关闭新模型/tool/Environment effect admission，并处理或分类唯一 pending Action。[R-030、R-048]

终止分类固定为：`WIN`、`action_budget_exhausted`、`model_failure`、`model_no_progress`、`checkpoint_failed`、`environment_lost`、`evidence_incomplete`、`evidence_corrupt`、`unknown_action_outcome`、`cancelled` 和 `controller_failure`。第 15.4、15.5 节固定其 CLI/SDK 分类；不得合并 WIN、已知非成功和 Unknown Outcome。[R-033、R-040、R-048]

- terminal record 前到达且能通过 identity/anchor 校验的 receipt 参与正常 reconciliation；
- terminal record 后到达的 Environment receipt、模型响应或 checkpoint 只能追加为 post-termination Evidence；
- 迟到 Evidence 不得重开 Run、执行后续 Action、删除 Unknown Outcome 发生事实或把非成功终止改写为 WIN；
- 若迟到 receipt 表明环境实际达到 WIN，审计可以记录“终止后获知的环境结果”，但规范 Run outcome 保持原终止分类。

### 12.10 故障矩阵

| 故障点 | 是否安全重试/继续 | 完成 Evidence | 规范结果 |
| --- | --- | --- | --- |
| 模型请求 intent 前 | 是 | 无 Environment 变化 | 重新请求 |
| 模型请求 intent 后、settlement 前 | AgentHarness captured policy 内 | settled assistant response | partial tool call 不执行；耗尽则 `model_failure` |
| safe 工具 intent 后、settlement 前 | 是，稳定 invocation/参数/anchor | committed tool outcome | replay 或返回既有结果 |
| 同一 assistant response 中 `play` 后还有 tool call | 否 | `play` 结果或其失败分类 | 后续调用以 `observation_required` 拒绝，无副作用 |
| `play` intent 前 | 是 | 无 Action intent | 普通重新调用 |
| Action intent 后、sidecar 权威证明未接受 | 允许首次提交 | 同实例 negative acknowledgement | 不是 replay |
| `play` 执行中或 receipt 不可查询 | 否 | 无 Turn commit | `unknown_action_outcome` |
| receipt 完成、Turn commit 前 | 不重发 Action | complete receipt + Raw Frames | 完成 Turn commit |
| Turn commit 后、Pi tool settlement 前 | 不重发 Action | Turn commit | 恢复 envelope 后继续 |
| RESET commit 后、boundary delivery 前 | 可重复交付 boundary | RESET Turn commit + retry_state | 新 Attempt，不重复 RESET |
| checkpoint request 后、完整 commit 前 | 同 anchor 可重试保存 | checkpoint commit marker | 部分文件无效；无法完成则 `checkpoint_failed` |
| checkpoint commit 后、delivery 前 | 可重复交付 | checkpoint commit | Game/Turn 不变 |
| sidecar 断开，无 pending Action | 只可重连同一实例 | anchor match | 失败则 `environment_lost` |
| sidecar 断开，有 pending Action | 仅查询同一实例 | receipt 或权威未接受证明 | 无法查询则 Unknown Outcome |
| Raw Frame 在 Turn commit 前缺失 | 可从同一 Environment response cache 修复 | 完整 receipt/frames | 无法修复则禁止 Turn commit |
| 用户取消且无 pending Action | 不继续 | 最后 Turn commit | `cancelled` |
| 用户取消时存在 pending Action | 仅允许先 reconciliation | receipt/Turn commit 或无完成 Evidence | 无法确认则 Unknown Outcome |
| controller/runtime storage fault，无 pending Action | 重启后校验最后完整 commit | 最后 Turn commit/binding | 可恢复；无法恢复则 `controller_failure` |
| controller/runtime storage fault，有 pending Action | 仅允许先 reconciliation | receipt/Turn commit 或无完成 Evidence | 无法确认则 Unknown Outcome |
| archive 在 Turn commit 后损坏 | 否 | digest mismatch audit finding | 停止新 Action，`evidence_corrupt` |
| terminal 后出现迟到结果 | 否 | post-termination Evidence | 不重开、不改写 terminal |

### 12.11 AgentHarness 与 ARC controller 的保证边界

| AgentHarness v4 可提供 | ARC controller/sidecar 仍必须提供 |
| --- | --- |
| session transaction 原子性、operation intent/effect/settlement、open operation inventory | Run binding、Environment instance identity、Action/Turn 状态机 |
| stable invocation ID、tool memo、`safe`/`never` recovery、outcome staging | `play: never`、actionId、receipt reconciliation、Unknown Outcome fail-closed |
| provider retry/partial-frame 恢复、lane `watch()`、immutable operation result | Environment Observation/Raw Frame authority、完整审计和 domain terminal record |
| runtime compaction/recovery primitives | GUIDE/WORKING/retry_state/checkpoint anchor 与 Context Boundary 语义 |
| 防止 settled tool effect 被 runtime 重放 | 不承诺 Environment exactly-once；sidecar 存活与状态一致性仍由 `pi-arc` 验证 |

`watchSession()` 当前仍未实现，不是 v1 正确性依赖。Pico3 仍为已评估但未采用的 experimental 证据。[R-011、R-012、R-049]

## 13. 第 3 轮遗留项的第 5 轮处理

1. binding、intent、receipt、Turn commit、checkpoint 和 terminal 的公共 record family 与稳定入口由第 15.7 节固定；字段必须生成 versioned schema 并由双端 contract fixture 验证。[R-038、R-041]
2. CLI/SDK 的公开 surface 由第 15.4、15.5 节固定。[R-033、R-034]
3. sidecar wire 行为由第 15.8 节固定；transport、进程监督和 receipt cache 介质是可替换实现选择，只要满足同实例查询、crash matrix 和离线 contract tests，不再作为规范 gate。[R-009、R-047]
4. Game 数据与质量配置分别由第 15.6 节和第 14 节固定。[R-023、R-024、R-039]
5. 旧项目退役是跨项目、不可逆操作，不属于 `pi-arc` v1 runtime；它保持 gated，未来只能在等价性验收后由 `memo-docs` 中单独 accepted ADR 和用户删除批准触发。[R-005]

以上处理不得改变第 12 节的 replay、Unknown Outcome、Environment instance 和 terminal 不可改写原则。

## 14. 第 4 轮质量与验证门禁（已确认）

### 14.1 单一职责

- Biome 只负责 TypeScript/JavaScript/JSON/JSONC 的格式、lint 和 import organize；Ruff 只负责 Python 格式、lint 和 import sort。[R-023、R-051]
- `tsc` 与 Pyright 只做静态类型检查，不承担格式化或 lint；Vitest 与 Pytest 只执行测试和 coverage。[R-023、R-051]
- CI 中所有源码检查必须只读；禁止 `--write`、`--fix`、生成后不校验差异或任何静默修改工作树的命令。自动修复只能由开发者显式执行。[R-024、R-054]

Biome 的 JSON/JSONC 范围只包含项目维护的配置、schema 和 fixture；npm 生成的 `package-lock.json` 不做格式化，由 dependency/lock gate 验证。[R-052、R-058]

### 14.2 固定工具链与依赖

第一个实现包必须使用以下精确版本；[`quality-gates.md`](design/quality-gates.md) 只解释依据，不增加或覆盖此表：[R-052]

| 工具 | 版本 |
| --- | --- |
| Node.js | `22.23.1` |
| npm | `10.9.8` |
| Python | `3.12.9` |
| uv | `0.8.12` |
| `@biomejs/biome` | `2.3.5` |
| `typescript` | `5.9.3` |
| `@types/node` | `22.19.19` |
| `pyright` | `1.1.413` |
| `vitest` | `4.1.9` |
| `@vitest/coverage-v8` | `4.1.9` |
| Ruff | `0.16.6` |
| Pytest | `8.4.2` |
| pytest-cov | `7.0.0` |
| coverage.py | `7.10.7` |

必须提交 `package-lock.json`（lockfile v3）与 `uv.lock`。所有直接依赖使用精确版本；CI 安装只允许 `npm ci --ignore-scripts --no-audit --no-fund` 和 `uv sync --locked --all-groups --python 3.12.9`，并要求 `uv lock --check` 通过。[R-052]

GitHub Actions 必须固定到以下完整 commit SHA，并保留标注版本注释：[R-052、R-059]

| Action | Commit SHA | 标注版本 |
| --- | --- | --- |
| `actions/checkout` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | v7.0.1 |
| `actions/setup-node` | `820762786026740c76f36085b0efc47a31fe5020` | v7.0.0 |
| `actions/setup-python` | `a309ff8b426b58ec0e2a45f0f869d46889d02405` | v6.2.0 |
| `astral-sh/setup-uv` | `08807647e7069bb48b6ef5acd8ec9567f424441b` | v8.1.0 |

workflow 权限默认为 `contents: read`，checkout 必须设置 `persist-credentials: false`。PR required checks 不执行 registry audit、真实数据下载或发布；供应链审计另设非阻塞定时任务。[R-052、R-059]

### 14.3 严格类型与边界

- TypeScript 使用 `strict`，并启用未检查索引、精确 optional property、隐式 override/return、switch fallthrough 和 side-effect import 检查；生产代码禁止未说明的 `any`、非空断言和 broad suppression。[R-053]
- Python 生产代码和测试均使用 Pyright `strict`；无类型第三方库必须通过窄 adapter/Protocol/stub 隔离，不得对整个目录关闭检查。[R-053]
- 领域层不得依赖 Pi、Node I/O、CLI 或 Python transport；Pi/`pi-ai` 只能出现在 adapter/composition boundary；Python sidecar 与 TypeScript 只能通过版本化协议和共享 contract fixtures 通信。边界由只读检查脚本或 architecture tests 强制。[R-057]

### 14.4 测试与 coverage

- Vitest 覆盖 TypeScript unit/contract/runtime adapter；Pytest 覆盖 Python Environment adapter、协议与 fixture；跨语言 contract suite 必须让两端消费同一组 fixtures。[R-055]
- offline integration 必须使用 Pi faux/in-memory model provider、确定性假 Environment、临时 artifact root 和受控 clock/ID；CI 清除 provider secret，并使意外网络访问立即失败。任何 required check 禁止调用真实模型、真实 provider 或远程 game 数据源。[R-024、R-055]
- TypeScript production code 的 statements/lines/functions 不低于 90%，branches 不低于 85%；Python production code line coverage 不低于 90%，branch coverage 不低于 85%。coverage 不能替代第 3 轮每个 crash point、Unknown Outcome 和 replay 场景的显式测试。[R-056]
- 1024×1024 边界、ACTION6 的 0/15/16/1023 映射、GAME_OVER/RESET/WIN、single-play-per-response、Action 三段协议、checkpoint partial write、sidecar disconnect、archive corruption 和 late result 必须有独立验收场景。[R-037、R-040–R-050、R-056]

### 14.5 资产与生成内容

下载的 game 数据、Run artifacts、coverage、build output、虚拟环境、依赖目录和临时 receipt cache 必须从 formatter/linter/type/test discovery 排除；它们通过 digest/schema/audit validator 检查，不得作为项目源码导入。[R-026、R-058]

小型 committed contract fixtures、失败注入 fixtures 和 schema 是测试输入，不得被 blanket exclude。生成文件必须拥有单一 source of truth 和只读 `generate --check` 等价门禁；CI 发现 drift 即失败。[R-058]

### 14.6 required checks

PR 合并至少需要以下稳定检查名全部通过：[R-059]

1. `quality / dependencies`
2. `quality / format-lint`
3. `quality / types-boundaries`
4. `test / typescript`
5. `test / python`
6. `test / contract`
7. `test / integration-offline`
8. `quality / specification`

稳定 script 名固定为 `check:dependencies`、`check:format-lint`、`check:types`、`test:ts`、`test:py`、`test:contract`、`test:integration`、`check:spec` 和顺序组合它们的 `check`。本地写入命令只能命名为 `fix:biome`、`fix:ruff-lint`、`fix:ruff-format` 或显式 snapshot/golden 更新命令，不得被任何 `check`/`test`/prepare hook 隐式调用。[R-054、R-059]

失败、跳过、超时、coverage 未达标、工作树被检查命令改写、secret/network sentinel 触发或 generated/lockfile drift 都视为未通过。命令展开和设计依据见 [`quality-gates.md`](design/quality-gates.md)，若与本规范冲突以本规范为准。[R-054、R-059]

### 14.7 可验证性

每个规范性 MUST/禁止项必须映射到静态检查、自动化测试或明确人工审阅之一；高风险的 Action/replay/Unknown Outcome/terminal 规则不能只依赖人工审阅。当前映射见 [`verification-matrix.md`](design/verification-matrix.md)，第 5 轮必须把遗留项明确归为已纳入、明确排除或保持 gated。[R-060]

## 15. 第 5 轮规范收敛修订（已确认）

本节关闭前四轮遗留的公开接口、数据、审计入口和跨语言 contract。它不规定内部类、模块、事务介质或进程监督实现。

### 15.1 反向审阅结论

| 审阅 | 结论 |
| --- | --- |
| 术语一致性 | `CONTEXT.md` 已补入 Replay；Run/Attempt/Turn、Retry/Recovery/Replay、Frame/Visual 未发现冲突 |
| 目标与非目标 | 保持单 Game Run、无头 CLI/SDK、无跨 Run 记忆、无 GUI/批量竞赛 |
| VISTA 覆盖 | 工具、1024×1024、全 Frame、GUIDE/WORKING、RESET/checkpoint、预测核对和失败边界均有规范条目与验证 ID |
| Pi 0.86 可行性 | stable `AgentHarness`、sequential tools、safe/never、lane watch 和公开 `pi-ai` surface 仍存在；`watchSession()` 仍不作为依赖 |
| 故障与竞态 | 第 12.10 节的每个 crash position 均映射到自动化验证；terminal/late result 无矛盾 |
| 安全重放 | `play`/RESET never；safe 工具带 invocation/anchor；首次提交与结果重新交付不再混称 replay |
| 审计完整性 | 第 15.7 节固定稳定入口、hash-linked domain ledger、Raw Frame 和 terminal/audit 边界 |
| 最小性 | 删除实时 SDK 订阅、直接工具驱动、交互式 OAuth、私有 provider 改写和跨进程任意 attach |
| 可测试性 | 所有公开 JSON、sidecar 消息和 artifact record family 都必须生成 schema 与共享 fixtures |
| 文档矛盾 | 已将“候选”“建议限制”和非规范文档承载精确版本等过时表述收敛到本规范 |

### 15.2 runtime 与环境依赖基线

v1 固定以下直接 runtime 依赖；全部使用精确版本并进入 lockfile：[R-011–R-013、R-026、R-052]

| 依赖 | 版本 | 用途 |
| --- | --- | --- |
| `@earendil-works/pi-agent-core` | `0.86.0` | stable `AgentHarness` v4 |
| `@earendil-works/pi-ai` | `0.86.0` | public Models/CredentialStore boundary |
| `arc-agi` | `0.9.9` | 官方 Game catalog、下载和 Environment 创建 |
| `arcengine` | `0.9.3` | Action 与 Environment 类型 |
| `pillow` | `12.2.0` | 确定性 Visual PNG 编码 |

Pico3、coding-agent 私有 `ModelRuntime`、VISTA package 和三个旧项目都不得成为 production dependency。升级任一 runtime 依赖必须更新事实基线、lockfile 和对应 conformance fixtures；Pi major/minor baseline 变化还必须重跑第 15.1 节 Pi 可行性审阅。

### 15.3 公共 JSON 约定

CLI events、artifact records 和 sidecar fixtures 均使用 UTF-8 JSON。对象拒绝未知字段；枚举拒绝未知值；整数必须位于 JavaScript safe integer 范围；时间使用带 `Z` 的 RFC 3339 UTC；digest 写作小写 64 位十六进制 SHA-256。JSONL 每行是一个完整对象并以 `\n` 结束，禁止在一条记录中嵌入未转义换行。每个 schema 都必须包含固定的 `schema` 字段，v1 不接受未知 major version。[R-038、R-040、R-055]

用于 digest 的 canonical JSON 必须按对象 key 的 Unicode code point 顺序排序、数组保持原顺序、无无意义空白，并以单个 `\n` 结束。digest 计算覆盖这些 UTF-8 bytes；schema fixture 必须锁定 canonicalization test vector。

### 15.4 无头 CLI 的精确 surface

可执行名固定为 `pi-arc`，v1 公开三个 command：[R-033、R-039、R-043]

```text
pi-arc run --game-id <versioned-id> --game-cache <dir> --provider <id> --model <id> --artifacts <new-dir>
           [--game-offline] [--thinking <level>] [--action-budget <positive-integer>]
pi-arc resume --artifacts <existing-dir>
pi-arc audit --artifacts <existing-dir>
```

- `run` 只接受匹配 `^[a-z0-9]{4}-[A-Za-z0-9]+$` 的完整 Game ID；artifact root 必须不存在或为空且不能是 symlink。`--thinking` 的值为 `off|minimal|low|medium|high|xhigh|max`，且必须被所选模型支持；Action budget 必须是 `1..999999` 的整数，省略时固定为 2000。
- `--game-offline` 只禁止 Game catalog/download 网络访问并要求 cache hit；它不改变 model provider 行为。required tests 仍必须通过 faux Models 和 network sentinel 禁止全部真实网络。
- `resume` 只能读取 artifact manifest 中固定的 Game、model、budget 和数据 digest；不得通过 flag 覆盖。它在触发模型或工具前执行第 12.4 节一致性检查。
- `resume` 遇到已有 terminal record 时不得恢复任何 runtime 或 Environment，只审计并返回既有 RunResult。
- `audit` 完全只读，不创建或恢复 Environment、不加载 provider credential，也不重写 `audit.json`；它在内存中重建并比较 schema、digest chain、Frame、terminal 和 outcome。
- stdout 只输出 JSONL；stderr 只输出人类诊断。每个 stdout 对象固定为 `schema`=`pi-arc.cli-event.v1`、`sequence`、`occurredAt`、`runId`（启动拒绝为 `null`）、`type` 和 `data`。`sequence` 从 1 连续递增。
- v1 event type 固定为 `run.started`、`run.resumed`、`model.requested`、`model.responded`、`tool.completed`、`tool.rejected`、`action.intent`、`environment.receipt`、`turn.committed`、`context.boundary`、`audit.finding`、`audit.completed`、`run.completed` 和 `run.rejected`。`run`/`resume` 的最后一条只能是 `run.completed` 或 `run.rejected`；`audit` 的最后一条必须是 `audit.completed`。

退出码固定如下；细分原因仍写入最终 JSONL record：[R-030、R-033、R-048]

| 退出码 | 含义 |
| ---: | --- |
| `0` | 权威 `WIN` 且 audit 通过 |
| `2` | CLI 语法、flag 或静态配置无效，Run 未开始 |
| `3` | Game、model、credential 或 artifact 前置检查拒绝，Run 未开始 |
| `10` | 已知非成功 Run Termination |
| `20` | `unknown_action_outcome` |
| `30` | `evidence_corrupt`、`controller_failure` 或 audit 未通过 |

`audit` 对可验证 archive 使用其既有 Run outcome 对应的 `0`、`10` 或 `20`；只有 archive 本身验证失败才返回 `30`。因此退出码 `0` 在任何 command 中都仍然只表示可验证的 WIN。

### 15.5 SDK 的精确 surface

package 根必须导出 `createPiArcHost`、`PiArcHost`、`RunRequest`、`ResumeRequest`、`RunInvocationResult`、`RunResult`、`RunEvent` 和 `AuditResult`。`createPiArcHost` 只接收调用者提供的公开 `pi-ai` `Models`；credential 必须已经封装在该 Models 实例中，SDK 不接收 raw API key。[R-013、R-034、R-035]

`PiArcHost` 只公开以下能力：

```text
run(request: RunRequest): Promise<RunInvocationResult>
resume(request: ResumeRequest): Promise<RunInvocationResult>
audit(artifactRoot: string): Promise<AuditResult>
readEvents(artifactRoot: string, afterSequence?: number): AsyncIterable<RunEvent>
```

`RunRequest` 必须且只能表达 CLI `run` 的同名逻辑输入：`gameId`、`gameCache`、`provider`、`modelId`、`artifactRoot`，以及可选 `gameOffline`、`thinkingLevel`、`actionBudget`、`signal`。`ResumeRequest` 只包含 `artifactRoot` 和可选 `signal`。

`RunInvocationResult` 的 discriminant `status` 只能是 `rejected` 或 `terminated`。`rejected` 不含 runId，只返回稳定 rejection reason；`terminated` 包含 `RunResult`。`RunResult.outcomeClass` 只能是 `win`、`non_success`、`unknown_outcome` 或 `audit_failure`，并包含 `runId`、Game locator/digest、固定 `terminationReason`、`lastCommittedTurn`、artifact root/manifest 和 audit summary。`AuditResult` 必须包含 `ok`、runId、manifest digest、ledger head 和结构化 findings。`RunEvent` 字段与第 15.4 节 CLI envelope 一致。

SDK 不公开 Pi session/lane 类型，不允许调用者直接执行单个模型工具，不提供非 durable 的实时 callback，也不承诺任意进程 attach。`readEvents` 只读取已持久化 CLI-compatible event，不改变 Run；调用方需要实时观察时可以在 Run 并发期间消费已提交记录。[R-034、R-049]

### 15.6 Game 获取与缓存契约

Game 权威来源固定为 `arc-agi==0.9.9` 暴露的官方 public environment catalog。source locator 写作 `arc-agi://public/<full-game-id>?sdk=0.9.9`；v1 Environment seed 固定为 `42` 并记录于 Run manifest。[R-026、R-039]

resolver 行为固定如下：

1. 只接受完整 versioned Game ID；catalog 必须精确返回同一 ID，禁止从 base ID 猜测最新版本。
2. cache miss 且未启用 game-offline 时，通过独立获取进程中的官方 SDK 下载到 `--game-cache` 下的新 staging directory；允许 `Arcade.make()` 在此阶段临时加载官方 Game code，并允许该进程持有 ARC 下载凭据。获取进程必须清除模型/provider/OAuth 凭据与 Pi 配置，不传入 Pi session 或 Run artifact root；ARC 凭据不得写入缓存、日志或运行产物。获取进程在交付下载结果后退出，校验与发布完成前不得被 Run 使用。获取阶段的 Environment 初始化结果不作为 Run 的初始 Observation，也不作为 Action/receipt Evidence。
3. cache miss 且启用 game-offline 时拒绝启动。cache hit 必须重新验证 manifest 和全部文件，不得仅凭目录存在通过。
4. cache 发布布局固定为 `<game-cache>/<full-game-id>/<tree-digest>/manifest.json` 和同级 `environment/`。cache root、Game 目录和 content root 都不能是 symlink。
5. cache manifest schema 固定为 `pi-arc.game-cache.v1`，包含 source locator、完整 Game ID、SDK/runtime 版本、seed 和按 `environment/` 内相对 POSIX path 排序的 `{path,size,sha256}` entries；manifest 本身不进入 entries。
6. tree digest 是上述 entries 的 canonical JSON SHA-256。`environment/` 禁止 symlink、非普通文件、路径穿越和未列文件；必须包含 `metadata.json` 和至少一个 `.py` Environment 文件。
7. 已发布 cache 不原地更新。相同 locator 与 digest 可复用；同 locator 不同 digest 必须拒绝并要求显式重新获取到新 digest 目录。
8. Run manifest 固定记录 source locator、tree digest 和 dependency versions。resolver 禁止扫描或 fallback 到 `memo-arc`、`memo`、`pi-memo`。
9. 除第 2 项的官方 SDK 获取阶段外，下载的 Environment code 只能在 Python Environment sidecar 中加载。正式 Run 必须在与获取进程分离的 sidecar 中从已验证缓存重新创建 Environment；sidecar 必须以 ARC SDK offline mode 启动、清除 ARC 下载凭据、provider/OAuth secret 和 proxy 配置、不注入网络 client、把 `environment/` 作为只读输入，并且不得获得 Pi session 或整个 artifact root 的路径；controller 只通过第 15.8 节 wire contract 接收结果。[R-035、R-047、R-058]

official catalog 是 v1 明确选择的代码信任根；用户接受官方 Game code 在获取阶段接触 ARC 下载凭据及该进程可访问资源的风险（见 [ADR-0005](adr/0005-official-sdk-acquisition-trust.md)）。进程边界不是针对恶意 Python 的安全 sandbox，digest 也只固定内容而不证明内容安全。required tests 使用 committed minimal fake game fixture 和 network/secret sentinel 验证 resolver 与 sidecar containment，不访问 official catalog；真实下载只属于显式的人工 smoke，不是 required check。

### 15.7 Run artifact 稳定入口与 record family

每个已开始 Run 的 artifact root 固定包含以下公开入口；内部索引可以增加文件，但不得替代这些入口：[R-038、R-041、R-048]

| 路径 | Schema/格式 | 规则 |
| --- | --- | --- |
| `manifest.json` | `pi-arc.run-manifest.v1` | write-once；Run/Game/model/runtime/坐标/seed/config 的脱敏快照 |
| `domain.jsonl` | `pi-arc.domain-record.v1` | append-only；binding、intent、receipt、Turn、knowledge、boundary、rejection、late Evidence |
| `runtime.jsonl` | `pi-arc.runtime-record.v1` | append-only；模型消息和必要 Pi event，secret 脱敏 |
| `frames/tNNNNNN/fNNNNNN.json` | `pi-arc.raw-frame.v1` | 原始整数网格；Turn 0 和每次 Environment response 的全部 Frame |
| `visuals/tNNNNNN/fNNNNNN.png` | PNG | 从对应 Raw Frame 确定性生成的 1024×1024 Visual |
| `knowledge/` | UTF-8 Markdown + versioned JSON index | GUIDE、WORKING、retry_state、Level archive 和 checkpoint snapshot |
| `terminal.json` | `pi-arc.terminal.v1` | write-once、唯一；outcome class、reason、last Turn、ledger head |
| `audit.json` | `pi-arc.audit.v1` | Run lifecycle 可重复生成的完整性结论和所有公开文件 digest/index；只读 `audit` command 只比较 |

`domain.jsonl` 每条记录除 payload 外必须包含递增 `sequence`、`recordedAt`、`recordType`、`previousDigest` 和本记录 `digest`；第一条 `previousDigest` 为 64 个 `0`。`digest` 是包含 `previousDigest`、但排除 `digest` 字段后的整条 canonical JSON 的 SHA-256。hash chain 只证明 archive 内部连续性，不取代 Environment receipt 或 Turn commit。record type 至少覆盖 `run.binding`、`action.intent`、`environment.receipt`、`turn.commit`、`tool.rejection`、`knowledge.commit`、`context.boundary`、`terminal.intent` 和 `post_terminal.evidence`。

Raw Frame JSON 必须保存原始宽高、颜色整数矩阵、Environment/Action/Turn identity 和 content digest；PNG 只是派生 Visual。`audit.json` 必须能从其他入口完全重建，允许在迟到 Evidence 后重新生成，但 `terminal.json` 永远不得改写。所有 record family 的 JSON Schema 必须从一个 source of truth 生成，并由 `check:spec` 检测 drift。[R-014、R-037、R-048、R-058]

### 15.8 TypeScript ↔ Python sidecar wire contract

跨语言 contract 使用统一 envelope：`schema`=`pi-arc.sidecar.v1`、唯一 `requestId`、`type` 和 `payload`。同一 request 恰好对应一个 response；response 复用 `requestId`，并包含 `ok` 或结构化 `error`，拒绝未知字段、未知 type 和 major version mismatch。error code 只能是 `invalid_request`、`version_mismatch`、`instance_mismatch`、`anchor_conflict`、`action_conflict`、`unavailable` 或 `internal`。[R-009、R-047、R-055]

v1 request type 固定为：

- `open`：输入已验证 Game cache locator/digest 和 seed，创建唯一 `environmentInstanceId` 并返回初始 Observation 与全部 Raw Frame；
- `get_anchor`：返回实例 identity、当前 committed environment turn、Observation digest 和 terminal state；
- `submit_action`：输入 `actionId`、instance identity、base Turn/digest 和单个 Action；
- `lookup_action`：只查询同一实例内的 `actionId`，不得触发 Environment；
- `close`：仅在 terminal/rejected cleanup 中关闭实例，不产生 Action。

`submit_action`/`lookup_action` 的 receipt status 只能是：

| Status | 权威含义 | controller 行为 |
| --- | --- | --- |
| `not_accepted` | 同一实例证明该 actionId 不存在且 base anchor 未变化 | 只允许一次首次提交 |
| `pending` | 实例已接受但尚无完整 durable result | 只可继续查询；不得重发 |
| `complete` | Observation、全部 Raw Frame、结果状态和 receipt digest 已完整 commit | 校验后提交 Turn，不重发 |

相同 actionId/相同参数的重复请求只能返回既有状态；相同 actionId/不同参数必须以 conflict 拒绝。`complete` receipt 必须直接包含完整 Observation 和全部 Raw Frame payload；sidecar 可以内部缓存该 payload，但不能只返回 controller 无法独立持久化的临时引用。transport、进程拓扑和 cache 介质不是公开契约，但所选实现必须通过同一 fixture corpus、断连和 crash matrix；任何 transport 都不能降低 Unknown Outcome 或同实例要求。

sidecar 的 `submit_action` 接收的是已映射 Environment Action：ACTION6 的 `x`/`y` 已按第 10.5 节转换为 `0..63`，RESET 不携带 `retry_state`；retry_state 只属于 controller 的 pending knowledge commit。sidecar 不得接收 1024×1024 tool coordinate 或模型笔记。

### 15.9 最终保留的 gated/非目标内容

以下内容明确排除在首个 v1 implementation handoff 外，不得由实现者顺带加入：

- 交互式 OAuth/login UI、provider 私有 headers、任意 request payload rewrite 和自定义 provider plugin；
- SDK 直接 tool driving、非 durable callback、任意跨进程 attach、远程 daemon/control plane；
- Pico3、`watchSession()`、跨 Run 经验、批量竞赛、GUI 和 Windows 支持；
- 旧项目删除。退役必须在新实现、数据重新获取和等价性验收后另行批准，并在 `memo-docs` 记录跨项目 ADR。[R-005、R-012、R-020、R-032]

内部 TypeScript/Python 类名、模块拆分、sidecar transport、ledger 事务介质和 response cache 介质不是 gated 行为，而是受 import boundary、wire schema、故障矩阵和测试约束的可替换实现选择。implementation handoff 不得把这些选择提升为新的公开契约。

## 16. 进入实现的必要条件

上述条件已于 2026-09-22 满足：第 5 轮获用户明确接受，ADR 0002/0003 同步 accepted，R-001 至 R-060 可双向追踪且高风险要求均有自动化验证 ID。因此允许创建 implementation handoff。handoff 获用户再次明确批准前不得编码；其首个 work package 只能实现项目骨架与第 14 节质量门禁，不实现 ARC 业务逻辑。
