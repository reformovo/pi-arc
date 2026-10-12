# 真实运行后的上下文与评测改进方案

状态：VISTA 对齐实现已合并并通过离线组合门禁；本文件是设计证据，不改变 accepted 规范或 CLI。来源：`../reviews/real-run-audit-2026-10-08.md`。

## 已能直接修复的事项

- 每个Action admission检查预算/取消，而非只在host外层prompt之间检查。
- audit与模型配置解耦；thinking严格支持校验。
- Node artifact发布file fsync + rename + parent fsync；不声称实测掉电安全。
- 逐provider request诊断指标使用公开hooks，保持原event vocabulary，通过payload.phase区分外层operation与provider attempt。只保存identity、计数、usage、耗时、HTTP status/stopReason，绝不保存正文、header、auth或错误原文。

## 上下文规则：按 VISTA 模型窗口触发

不能用删thinking、改provider payload或把boundary prompt追加到原lane，冒充checkpoint/新Context。当前图片64上限保留为服务端兼容保护，不是完整上下文策略。

撤回固定 200000-token 提案。用户在复核 VISTA 后授权执行其基线：normalLimit=contextWindow-32000-40000，checkpointLimit=contextWindow-32000；正常阈值低于16000时拒绝该checkpoint策略，不猜测模型窗口。DeepSeek 1000000窗口对应928000/968000。触发基于完整输入（input+cacheRead+cacheWrite），不是扣除缓存后的input；在安全边界保存checkpoint，不执行任何新的Game Action。32k硬预留与40k checkpoint headroom来自VISTA Codex runner。

步骤：

1. 每次响应记录usage，判断阈值。不能在有pending Action时导航/丢弃authority。
2. 当前工具结果完成后，让模型operation停止；以KnowledgeStore.requestCheckpoint固定当时anchor。只允许save_compact_checkpoint，所有普通工具继续由既有gate拒绝。
3. 单独发出CHECKPOINT_PROMPT；校验完整GUIDE（或明确沿用）和非空WORKING、anchor及commit marker。失败按checkpoint_failed，不伪造摘要或继续play。
4. 将Pi lane导航到根/新的公开context位置，然后接纳同一committed boundary operation，交付权威envelope。**lane.accept/drive本身不会清空历史**；必须检验模型实际收到的上下文。
5. 接纳成功后ack boundary，才开放play；重启后仍使用同一boundary identity，绝不重放Action。
6. 恢复envelope仅包括必要当前Level记录、最后动作、当前Observation和committed笔记；完整Frame/ledger/session仍归档可查询。

VISTA cd82历史记录window1000000、normal928000、checkpoint968000、session_segments=1，未触发checkpoint。它的高缓存命中不能归因于checkpoint；pi-arc这局443985末次输入也低于VISTA触发阈值。因此本轮先对齐恢复机制，再独立定位缓存请求prefix/路由差异；较低checkpoint阈值仅可作为另一个明确标注的实验。

离线验收已覆盖：完整cached input触发边界、checkpoint allowance、拒绝/保存失败/普通工具阻断、无动作循环、attach恢复attempt、fresh admission中断与恢复、真正清除旧thinking/图片而保留authority/笔记/当前图像、预算/WIN/取消回归。模型原生自动Compaction禁用，公开compaction hook拒绝绕过ARC checkpoint。36个runtime integration用例通过；全量check为182 TS、29 Python、双端contract各4、67 integration，build/diff check通过。恢复effect_pending恰好跨阈值的专门场景尚未补齐；使用已报告usage在安全工具边界触发不是精确预计算下一次wire token，真实provider及极端上下文余量仍须验证。真实调用另外授权。

## 缓存与性能实验

- 不将cacheWrite=0当错误；以cacheRead/完整输入计算加权命中。
- VISTA历史manifest汇总input55864856/cached55763712，命中99.82%；但实际Codex stdout最后tokenUsage.total为input54646603/cached54547712，重复tokenUsage通知至少5次，manifest是对每次last简单累加（runner.py:_observe_notification/_add_usage），存在汇总偏差。修正口径后命中仍约99.82%，不能用这点否认实际缓存差距；不修改VISTA证据仓库。
- pi-ai已通过公开OpenCode provider wrapper添加x-opencode-session，AgentHarness sessionId为session.id:lane；不能未经证据声称缺少session affinity。pi-ai thinkingSignature=reasoning_content会把历史thinking交回协议；VISTA Codex通过turn/steer返回play图像、inspect会interrupt/start新turn，同一thread保留。客户端消息布局不同已确认；服务器实际prefix/cache路由原因尚无wire证据，不能只凭base64形式推断。
- 离线公开provider探针已验证：传入synthetic apiKey/sessionId并注入mock fetch，实际构造path=/zen/go/v1/chat/completions、model=deepseek-flash、x-opencode-session=audit-session:arc；没有真实HTTP或凭据读取。因此现有接线没有丢失OpenCode session header。不能据此证明服务端路由和缓存正常。
- 本轮缓存定位无真实请求；后续验证须保存安全的结构/计数/hash与服务端usage，不能为了日志保存凭据或原始request正文。
- 每次图片窗口替换会改变旧prefix；比较按阈值分段上下文与逐图滑窗，记录真实hit、未缓存输入、耗时，不预先认定因果。
- 保持min/max工具参数不变，先测量逐请求图片数、usage、请求时长、ledger发布耗时和磁盘增长；未证实瓶颈前不重写ledger存储格式。
- 多次运行、不同游戏和Linux故障矩阵不属于本次单局成功证明；WP-10仍需单独授权。

## 评测基线

VISTA历史cd82记录：Game cd82-fb555c5d、offline、Codex、opencode-go/deepseek-flash、max、vision/render_grid=true、154动作、WIN；manifest arc_agi_version=null。pi-arc成功记录：同Game ID/provider/model/thinking、seed42、Game digest883bc976082536041dc59b97c75bcb130e26beaaf8fcf5fe65690c9c07c25d66、134动作、WIN。

不能证明服务端历史alias映射版本相同；VISTA metadata未提供SDK版本，render_grid也需实际像素比较，不能宣称严格同条件。

建议每次评测保存无secret的独立report：实际endpoint origin/path、model wire ID与服务端可得revision、工具/提示词摘要、SDK/engine/Python版本、Game digest、seed、参数、总请求数/动作/关卡、缓存/时延、实际账单出处和audit结果。不要未经schema/规范评审新增write-once manifest公开字段，不复制旧Game或给agent提供历史解法。
