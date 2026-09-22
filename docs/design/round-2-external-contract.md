# 第 2 轮外部契约设计证据

> 状态：设计证据，不是实现契约。规范性结论只以 [`docs/pi-arc.md`](../pi-arc.md) 第 10 节为准。

本文件记录第 2 轮如何从 Pi 0.86 和 VISTA `63c8843` 的可观察 surface 推导 `pi-arc` 外部契约。它不授权实现者在 gated 项目上自行取舍。

## 1. Pi 0.86 的可用边界

本轮复核的 Pi HEAD 为 `d1230ea2000d876b479a69b8b061f9d670f262f5`，`@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai` 为 `0.86.0`，工作树干净。

### 1.1 AgentHarness v4

稳定根导出包含 `AgentHarness`、`AgentLane`、`AgentHarnessOptions`、`OperationRequest`、`RunResult`、`WatchHandle`、`LaneSnapshot` 和结构化 `Result`/错误类型。公开接口提供：

- `AgentHarness.create(options, context)`，恢复 durable lane 的小型投影并返回 `{ harness, open }`；创建本身不自动驱动 open operation；
- lane 级 `prompt`、`accept`、`drive`、`resume`、`compact`、`requestAbort`、`watch` 和稳定 invocation identity/memo；
- `AgentHarness.events`、`hooks` 和 lane/session snapshot；
- `AgentHarness.close(context)`。

当前代码与文档仍明确 `watchSession()` 是未实现 surface（当前实现抛出 `SliceNotImplemented`），因此 `pi-arc` 只能把 lane 级 watch 和自身审计作为候选基础，不能把 session-wide watch 当作已验证依赖。

Pi 的 `replay: "safe" | "never"`、tool memo、operation identity 和 durable result 解决的是 agent tool/runtime 的恢复问题，不证明 ARC Environment 的外部 Action 已 exactly-once。`play` 应声明为不可安全重放，并由 `pi-arc` 单独维护 Environment Evidence。

### 1.2 公开 pi-ai

`pi-ai` 0.86 的 `Models` surface 负责 provider/model catalog、`getModel`/`getAvailable`、`getAuth`、`login`/`logout`、`stream`/`complete` 以及 deferred request；`CredentialStore` 负责按 provider 串行化凭据读取/修改/删除。模型由 `provider` + `modelId` 标识，provider-specific auth 可以来自环境、API key 或 OAuth。

因此 `pi-arc` 的公开配置只接受领域级 model identity、thinking level 和经审定的请求选项；凭据通过 `Models`/`CredentialStore` 进入 runtime，不能把 secret 写入 CLI 参数、Run manifest 或 Pi transcript。OAuth 交互和 provider-specific 环境字段需要在安全审阅中再固定。

## 2. VISTA 行为证据映射

VISTA 已提交版本的 Codex 工具提供以下可观察语义：

| VISTA surface | 采纳到 `pi-arc` 的外部行为 | 不直接采纳 |
| --- | --- | --- |
| `play` 每次只执行一个 action，返回 final visual、frame count、available actions | 一个确认 Action 对应一个新 Turn；结果先交给模型再允许下一次 `play` | controller 私有字段和 provider transport |
| `inspect` 按 turn/frame/region 读取归档 visual | 只读历史视觉证据，区域和 ACTION6 共用 1024×1024 坐标 | Python 函数和图片目录命名 |
| `read_pixels` 等分中心采样、局部 palette、总样本上限 | 确定性离散取样，不做图像解释 | 具体编码字符表是否公开 |
| `history` 的 `attempts`/`events` | 提供 Attempt 摘要和 Environment event 读取 | 当前 JSON metadata 的字段布局 |
| GUIDE/WORKING 工具与 Level archive | GUIDE 跨 Attempt/Level；WORKING 在 Level 边界归档后清除 | 文件权限、私有路径和原子写入细节 |
| `save_compact_checkpoint` 与 `retry_state` | 显式 checkpoint 和 RESET continuation state | 当前 marker 文件和 fresh thread 实现 |
| `DISPLAY_SIZE = 1024`、`GRID_SIZE = 64` | 1024×1024 显示/工具坐标到 64×64 环境网格 | render scale 可调参数 |

## 3. 为什么本轮不暴露内部 Pi 类型

直接把 `AgentHarness`, `AgentLane`, `Session`, `OperationResultRecord` 或 `AgentHarnessToolInvocation` 作为 `pi-arc` SDK 类型，会把 Pi 的 lane/session 生命周期错误地提升为 Run/Turn 语义，也会让 `watchSession()` 未实现和未来 Pi runtime 演化泄漏到 ARC 契约。因此本轮只承诺领域结果、工具行为和审计 Evidence；具体 adapter 仍属于后续 work package。

## 4. 仍需审阅的外部取舍

- CLI 是否把事件 JSONL 作为默认 stdout，及 exact exit code table；
- SDK 是否允许 attach/resume 已存在 artifact root；
- `CredentialStore` 的 SDK 注入边界和 headless OAuth policy；
- 公开限制（GUIDE/WORKING 字符数、视图/样本上限）是否完全固定；
- artifact logical records 到具体文件名/编码的映射；
- dataset resolver 的 source locator、缓存和离线策略。

这些取舍在唯一规范中显式标为 `gated` 或待审提案，不能从本文件推断默认实现。
