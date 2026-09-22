# 第 2 轮评审记录：外部行为契约

> 状态：已通过（2026-09-21）。本文是评审记录，不是实现契约。

## 本轮完成项

- 将第 1 轮标记为用户确认通过，并把规范推进到 `design-round: 2`。
- 复核 Pi 0.86 stable `AgentHarness`、lane `watch()`、`AgentHarness.create()`、公开 `pi-ai` `Models`/`CredentialStore` 和当前未实现的 `watchSession()`。
- 对照 VISTA `63c8843` 的 `play`、`inspect`、`read_pixels`、history、GUIDE/WORKING、checkpoint 和 1024×1024 坐标行为，形成外部契约提案。
- 在唯一规范中加入无头 CLI、SDK、模型配置/凭据、工具语义、坐标/视觉、artifact 最小集合、game 数据重新获取和场景验收。
- 将内部 Pi 类型、精确 CLI flags、文件名、退出码、数据源和恢复竞态明确列为 gated；没有创建源码、依赖、配置或游戏资产。

## 本轮核心提案

1. CLI 的 `run` 只运行一个 Run；stdout 为机器可读事件/结果流，stderr 为诊断，`0` 只表示 WIN；精确退出码仍 gated。
2. SDK 只暴露 Run、工具结果、终止分类和 Evidence 语义，不暴露 Pi `AgentHarness`/session 类型，也不承诺 Environment exactly-once。
3. 模型配置以 `provider` + `modelId` + `thinkingLevel` 为最小身份，通过公开 `pi-ai` `Models`/`CredentialStore` 解析；禁止命令行明文 key 和未声明的 headless 交互。
4. `play`、`history`、`inspect`、`read_pixels`、GUIDE/WORKING 和 checkpoint 的只读/有副作用边界、拒绝条件和终止行为已写入规范提案。
5. 所有面向模型的坐标统一为 1024×1024，ACTION6 使用 `floor(x * 64 / 1024)` 映射，原始 Frame 全部归档，Visual 只是派生证据。
6. 每个真正开始的 Run 必须有 manifest、Environment records、Raw frames、Visual index、Action/effect log、Model/runtime record、Knowledge snapshots 和 Terminal/audit index。
7. Game 必须由统一 resolver 重新拉取或从已验证缓存恢复；旧项目文件不能隐式 fallback，具体数据源与缓存策略 gated。

## 正常、拒绝和终止场景覆盖

| 场景 | 本轮契约 |
| --- | --- |
| 合法 `play` | 一个 Action、一个新 Turn、关联 Observation/全部 Frame/Visual |
| 非法输入 | 结构化拒绝，无 Turn、无 Environment 副作用 |
| 只读工具/笔记 | 可产生结果或笔记 Evidence，但不改变 Game/Turn |
| GAME_OVER/RESET | RESET 记录为新 Action，交付 retry_state，开始同一 Level 的新 Attempt |
| WIN 后 Action | 终止拒绝，最终 record 保留唯一 WIN |
| 缺凭据/provider 不可用 | 首个 Action 前拒绝 |
| 缺帧/坏帧 | 错误或 Unknown Outcome，不以 Visual 伪造 Raw frame |
| 数据摘要不匹配 | 启动拒绝，不读取旧项目副本 |

## 本轮没有作出的决定

- 没有确定 CLI 精确参数名、退出码数值、JSONL envelope 或 artifact 文件名。
- 没有确定 SDK 的 TypeScript signatures、attach/resume 语义或实时订阅类型。
- 没有确定 OAuth 登录交互、provider-specific headers/env 和密钥 helper。
- 没有确定 game 数据权威来源、远端协议、缓存目录、离线策略或 digest 算法。
- 没有确定 Action 提交点、replay、Unknown Outcome 后继续/中止及迟到结果策略。
- 没有确定 checkpoint/Recovery 的 durable 竞态或 Python sidecar 重连。
- 没有创建 implementation handoff、ADR 或 work package。

## 审阅结论

用户于 2026-09-21 确认审阅通过：

1. 接受规范第 10 节的 CLI、SDK、模型配置和凭据边界；
2. 接受 `play`、视觉/像素、history、GUIDE/WORKING 和 checkpoint 的外部语义与建议限制；
3. 接受 1024×1024 坐标、64×64 映射和全部 Raw Frame 归档要求；
4. 接受 Run artifact 最小集合与 game 数据不得从旧项目隐式回退的要求；
5. 接受列出的 gated 项目，批准进入第 3 轮持久性与失败语义设计。
