# 第 1 轮评审记录：语言、目标和边界

> 状态：已通过（2026-09-21）。本文是评审记录，不是实现契约。

## 本轮完成项

- 将第 0 轮评审标记为通过，并把 VISTA 基线更新到已提交、干净的 `63c8843`。
- 创建 `CONTEXT.md`，为 Run、Game、Level、Attempt、Turn、Action、Observation、Frame、Visual、Evidence、GUIDE、WORKING、Context Boundary、Compaction、Unknown Outcome、Recovery 等词确定单一含义和禁用同义词。
- 在唯一规范中提出 v1 目标、可观察成功标准、明确非目标、参与方责任和信任边界。
- 用正常 Action、非法输入、只读工具、GAME_OVER/RESET、Level 完成、WIN、模型停止和环境异常八类场景反向检验术语。
- 扩展需求追踪表，加入第 1 轮的 R-027 至 R-032；用户已确认本轮结论。
- 保持 docs-only：没有源码、依赖、工具配置、game 数据或 work package。

## 本轮核心结论

1. Run 是产品领域生命周期，不是 Pi session、模型上下文或进程；一个 Run 在 v1 中只承载一个 Game，但可以跨多个 Level、Attempt 和 Context Boundary。
2. Turn 是已执行环境 Action 与权威 Observation 的序号；初始 Observation 是 Turn 0，非法输入和非 Action 工具不推进 Turn。
3. GAME_OVER 只结束 Attempt。RESET 是同一 Level 内开始新 Attempt 的 Action，也是 Context Boundary，但不是 runtime Recovery。
4. 中间 Level 完成不结束 Game 或 Run；GUIDE 延续，WORKING 归档后从活动状态移除。
5. 只有 Environment 的 WIN 构成成功；模型停止、进程正常退出或 Pi session 完成都不能替代 WIN。
6. Environment Observation 是游戏状态唯一权威；模型笔记和 durable runtime 记录不能单独证明 Action 已执行。
7. VISTA 是提交固定的设计证据，旧项目保持只读且不提供 runtime 或 game 数据。

## 设计压力测试发现

| 发现 | 处理 |
| --- | --- |
| `Turn` 容易与 LLM turn 混淆 | 词汇表明确禁止“模型回合”含义；后续公共字段必须沿用环境 Turn 语义 |
| RESET 同时涉及游戏重试和模型换上下文 | 分为 RESET、Retry、Context Boundary 三个概念；Recovery 保留给 runtime 中断 |
| 一个 Action 可能完成 Level，也可能直接 WIN | Level 完成保持 Run；最终 WIN 同时终止 Attempt、Game 和 Run |
| runtime durable 记录可能被误当成环境完成证明 | 信任边界明确只有关联到权威 Observation 才能确认下一 Turn |
| 模型停止与环境异常有多种时序 | 本轮只确定“不得记为 WIN”；提交点、恢复和 Unknown Outcome 留到第 3 轮 |
| 旧 game 文件已有哈希，容易诱发隐式复用 | 明确只作事实证据；新项目统一重新拉取并验证数据 |

## 本轮没有作出的决定

- 没有定义 CLI 参数、SDK 类型、tool schema、metadata 字段或运行目录结构。
- 没有选择 game 数据集权威来源、版本、缓存或离线行为。
- 没有把 stable `AgentHarness` 的全部能力提升为 `pi-arc` 保证。
- 没有决定 Action 提交点、exactly-once、replay、Unknown Outcome 或迟到结果策略。
- 没有定义 checkpoint 文件、Recovery 状态机或 sidecar 重连策略。
- 没有创建 ADR：旧项目最终删除边界仍未完成取舍，其余本轮内容属于词汇和规范边界。
- 没有创建 implementation handoff 或 work package。

## 后续 gated 问题

| 问题 | 影响 | 处理轮次 |
| --- | --- | --- |
| game 数据源、版本、缓存、离线使用和完整性校验 | 可复现性与供应链边界 | 第 2、4 轮 |
| CLI、SDK、工具参数及拒绝/终止响应 | 外部兼容性 | 第 2 轮 |
| 原始 Frame、Visual、history、笔记和 audit 的产物契约 | 证据完整性 | 第 2 轮 |
| Pi runtime session 与 Environment 实例身份如何绑定 | 恢复正确性 | 第 3 轮 |
| model stop、sidecar 断开、迟到结果和 Unknown Outcome 的处理 | 安全继续与终止 | 第 3 轮 |
| 最终删除旧项目是否包含全部原始运行材料 | 不可逆数据删除 | 最终退役审阅 |

## 审阅结论

用户于 2026-09-21 确认审阅通过：

1. 接受 `CONTEXT.md` 中的领域词义和禁用同义词；
2. 接受一个 v1 Run 只承载一个 Game，但可跨多个 Level、Attempt 和模型 Context Boundary；
3. 接受 Turn、GAME_OVER、RESET、Level 完成和 WIN 的上述边界；
4. 接受 v1 目标、明确非目标、参与方责任和信任边界；
5. 批准进入第 2 轮，定义 CLI、SDK、工具协议、模型配置和运行审计产物。
