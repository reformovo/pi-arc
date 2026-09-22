# 第 1 轮场景与边界分析

> 状态：设计证据，不是实现契约。规范性结论只以 [`docs/pi-arc.md`](../pi-arc.md) 为准。

## 1. 分析目标

本轮只检验领域词汇、v1 目标和责任边界是否能一致描述真实场景，不设计类、模块、wire shape、存储格式或恢复算法。行为证据来自 VISTA 提交 `63c8843822cb371bb52a59f0cee18c4020f2494b`，但只有被唯一规范采纳的行为才构成 `pi-arc` 要求。

## 2. 容易混淆的边界

| 容易混淆的说法 | 采用的区分 | 原因 |
| --- | --- | --- |
| Run 等于 Pi session | Run 是产品领域生命周期；一个 Run 可跨多个模型上下文和 runtime session | session 恢复或更换不能重置游戏计数和审计身份 |
| Game 等于 Level | Game 可含多个 Level，只有全部完成才 WIN | VISTA 观察包含 `levels_completed` 与 `win_levels`，中间 Level 完成不是终局 |
| Attempt 等于 Run | Attempt 只在当前 Level 内，由 GAME_OVER、Level 完成或终止划界 | RESET 后仍是同一 Run 和 Game |
| Turn 等于模型回合 | Turn 只随已执行环境 Action 前进 | 读取历史、检查视觉、写笔记和模型空答都不能伪造环境进度 |
| RESET 等于 Recovery | RESET 是改变游戏状态的 Action；Recovery 是保持已确认游戏状态的 runtime 连续性操作 | 两者的副作用、重放风险和审计含义完全不同 |
| GAME_OVER 等于失败终止 | GAME_OVER 只结束 Attempt；若 RESET 可用，Run 仍可继续 | 否则无法表达同一 Level 的多次尝试 |
| 进程正常退出等于成功 | 只有权威 WIN 才是成功 | 模型可能提前停止，runtime 也可能在未知环境状态下退出 |

## 3. 场景检验

### S1：正常 Action

初始 Observation 是 Turn 0。模型调用 `play` 提交合法 Action；Environment 确认执行并返回含多个 Frame 的 Observation。新 Observation 位于 Turn 1，所有原始 Frame 均属于同一结果 Evidence，供模型看到的 1024×1024 Visual 是派生视图。

检验结果：Run、Game、Level、Attempt 保持不变；Action、Turn、Observation、Frame 和 Visual 各有单一含义。

### S2：非法输入

模型提交当前不可用的 Action、缺少 ACTION6 坐标或坐标越界。输入在进入 Environment 前被拒绝；模型可以修正后再试。

检验结果：拒绝不创建 Turn，不开始新 Attempt，也不改变权威状态。“重试一次 tool call”不能称为 Retry；本项目的 Retry 专指 GAME_OVER 后经 RESET 开始新 Attempt。

### S3：只读工具和笔记

模型调用 `history`、`inspect`、`read_pixels`，或读写 GUIDE/WORKING。这些操作可能产生新的工具结果或持久文件，但不触碰 Environment。

检验结果：它们不是 Action，不推进 Turn。笔记可以成为模型连续性材料，但不能覆盖 Observation。

### S4：GAME_OVER 后 RESET

Turn 7 的 Action 返回 GAME_OVER，当前 Attempt 结束。Run 未终止；Environment 只允许 RESET。RESET 携带 `retry_state`，成功后产生 Turn 8，并在同一 Level 开始下一 Attempt；模型上下文可以在此形成 Context Boundary。

检验结果：RESET 同时是 Action 和 Retry 边界，但不是 Recovery；新模型上下文不等于新 Run。

### S5：完成中间 Level

某个 Action 返回 `levels_completed` 增加且尚未 WIN。该 Action 的 Observation 已属于下一 Level 的入口状态。GUIDE 继续有效，旧 WORKING 先归档为 Evidence，再从活动状态中移除。

检验结果：Game 和 Run 保持不变；旧 Level 的 Attempt 结束，新 Level 从同一 Turn 的权威 Observation 开始。是否为 Level 单独编号以及归档字段留到第 2 轮。

### S6：WIN

某个 Action 返回 WIN。该 Action 仍拥有完整 Turn、Observation 和 Frame Evidence；随后 Game 与 Run 成功终止，任何进一步 Action 都必须被拒绝。

检验结果：最终 Level 完成和 WIN 可以由同一个 Observation 表达，不需要人为添加 RESET 或终止 Action。

### S7：模型停止或上下文变化

模型在未 WIN 时停止输出，或者因 Compaction、上下文上限、runtime 故障而更换上下文。若没有 Action，环境状态不应变化。

检验结果：Compaction、Context Boundary 和 Recovery 不创建 Turn 或 Attempt。模型停止不能冒充 WIN；是否恢复以及何时终止由第 3 轮失败语义决定。

### S8：环境异常与迟到结果

若异常发生在 Action 明确未提交前，可以证明没有环境副作用。若 Action 可能已送达，但返回 Observation 缺失、sidecar 断开或结果迟到，则存在 Unknown Outcome。

检验结果：Pi session 或 tool invocation 完成记录不足以证明环境结果。第 3 轮必须按提交点和完成 Evidence 分类，而不能把所有异常统一称为 Recovery。

## 4. 责任与信任检查

| 事实或决定 | 唯一权威 | 其他参与方可做什么 |
| --- | --- | --- |
| 当前游戏状态与可用 Action | ARC Environment 的 Observation | `pi-arc` 校验、呈现和归档；模型只能提出假设 |
| Run 是否继续或终止 | `pi-arc` 按规范结合权威 Observation 判断 | Pi 提供 runtime 事件，模型可主动停止但不能声明 WIN |
| 模型请求和 tool loop 持久性 | Pi stable `AgentHarness` 的公开能力 | `pi-arc` 不把 session durable 等同于环境 exactly-once |
| GUIDE/WORKING 内容 | 模型负责撰写，`pi-arc` 负责边界和 Evidence | Environment 不读取它们来决定游戏真相 |
| game 数据内容 | 后续审定的数据源与完整性记录 | 旧项目文件只作历史证据，禁止隐式回退 |
| 行为规范 | `docs/pi-arc.md` | VISTA 和设计文档只提供证据 |

## 5. 留给后续轮次的问题

1. Run、Game、Level、Attempt、Turn 在 CLI、SDK、工具 metadata 和运行目录中如何编码。[第 2 轮]
2. Level 边界、RESET、WIN 和非成功终止分别必须产出哪些文件与事件。[第 2 轮]
3. model stop 是否允许自动继续、允许几次、以何种 Evidence 为前提。[第 3 轮]
4. Action 的提交点和完成 Evidence，以及 Unknown Outcome 后是否存在任何安全继续路径。[第 3 轮]
5. durable Pi session 与仍存活 Environment 的身份如何绑定。[第 3 轮]
6. game 数据源、版本、缓存、离线 fixture 和完整性验证。[第 2、4 轮]

这些问题保持 gated，不影响第 1 轮确认领域边界，但不得由实现者静默补全。
