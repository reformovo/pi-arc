# pi-arc 领域语言

> 状态：第 1 轮已确认；Replay 补充于第 5 轮确认（2026-09-22）。

本词汇表为 `pi-arc` 选择唯一、稳定的领域用语，使规范、评审和未来实现用同一组概念描述 ARC 单局运行。它只定义词义，不定义类、模块、存储格式或协议字段。

## 运行与进度

**Run**:
一次以一个 Game 为对象的完整执行，从初始 Observation 建立开始，到 Run Termination 为止；RESET、Compaction 或 Recovery 都不会创建新 Run。
_Avoid_: Session、任务、实验、进程

**Game**:
由稳定 game ID 标识的一项 ARC 挑战，可包含一个或多个依次推进的 Level。
_Avoid_: Task、Puzzle、Environment、数据集

**Level**:
Game 内一个连续的进度单元；完成后进入同一 Game 的下一个 Level，全部完成后才达到 WIN。
_Avoid_: Game、关卡 Run、Stage

**Attempt**:
在一个 Level 内从首次进入或一次 RESET 后开始，直到 GAME_OVER、Level 完成、WIN 或 Run Termination 的连续尝试。
_Avoid_: Run、Session、Retry、回合

**Turn**:
Run 中一个已执行 Action 及其权威 Observation 所处的顺序位置；初始 Observation 位于 Turn 0。
_Avoid_: Step、模型回合、tool call 序号

**Run Termination**:
Run 被关闭且不再接受 Action 的状态，必须带有明确原因；它既可能是 WIN，也可能是非成功结束。
_Avoid_: GAME_OVER、模型停止、进程退出

## 环境交互与证据

**Action**:
意图改变权威游戏状态的环境命令，包括 RESET；调用普通读取或笔记工具不是 Action。
_Avoid_: Tool call、Request、点击

**Observation**:
ARC Environment 在初始化或处理 Action 后返回的权威游戏状态陈述，可包含一个或多个 Frame。
_Avoid_: Screenshot、模型描述、笔记

**Frame**:
Observation 中环境直接产生的一张原始视觉帧；它不是裁剪、放大或标注后的模型视图。
_Avoid_: Render、Screenshot、Inspection

**Visual**:
从 Frame 确定性派生、供模型观察或检查的视觉表示；Visual 不能取代其来源 Frame。
_Avoid_: Frame、Observation、Evidence

**Evidence**:
带来源和顺序关系、可用于独立核对 Run 行为的持久记录；模型陈述本身不构成环境事实 Evidence。
_Avoid_: Log、笔记、总结

## 结果与继续方式

**GAME_OVER**:
当前 Attempt 的失败结果；它不终止 Run，且同一 Level 只能通过 RESET 开始新的 Attempt。
_Avoid_: Run Termination、WIN、环境崩溃

**WIN**:
Game 已完成的权威终局结果，同时构成 Run 的成功终止。
_Avoid_: Level 完成、模型声称完成、正常退出

**RESET**:
在 GAME_OVER 后请求环境重置当前 Level 的 Action；成功后开始新的 Attempt。
_Avoid_: Recovery、Replay、重新运行

**Retry**:
因 GAME_OVER 而通过 RESET 开始新 Attempt 的领域行为；它不表示自动重发请求或重放 Action。
_Avoid_: Recovery、Replay、网络重试

**Replay**:
运行时中断后再次执行同一 tool invocation 的行为；它与首次提交、重复交付既有结果以及 Retry 都不同。
_Avoid_: Retry、Recovery、结果重新交付

**Unknown Outcome**:
Action 可能已到达环境，但缺少足以确认是否执行以及结果为何的权威 Evidence。
_Avoid_: 普通错误、拒绝、超时

## 模型知识与上下文连续性

**GUIDE**:
模型在当前 Run 内维护的长期、可修订游戏理解；它可以跨 Attempt 和 Level 延续，但不是权威游戏状态。
_Avoid_: 跨 Run 记忆、规则真相、系统提示

**WORKING**:
模型为当前推理维护的短期、可替换工作状态；它不是权威游戏状态，也不是永久经验库。
_Avoid_: GUIDE、Checkpoint、跨 Run 记忆

**Context Boundary**:
旧模型上下文不再被假定可用、继续执行必须显式交付所需状态的边界；它本身不改变 Game 或 Environment。
_Avoid_: RESET、Run Termination、进程重启

**Compaction**:
在保持权威游戏状态不变的前提下，用显式保存的精简状态替换过长模型上下文的连续性操作。
_Avoid_: RESET、Recovery、普通摘要

**Recovery**:
运行时中断后，基于已确认 Evidence 恢复继续执行能力的过程；它不是 RESET，也不得把 Unknown Outcome 当作可安全重放的 Action。
_Avoid_: Retry、Replay、重新开始 Game
