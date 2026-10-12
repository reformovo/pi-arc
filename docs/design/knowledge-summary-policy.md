# 笔记语义策略：离线实验候选，不修改生产提示词

用户要求按建议顺序推进：先稳定基线，再评审notes策略。harness坐标歧义/Attempt来源已修，不用模板补丁掩盖工具错误。本文是设计证据，不改变accepted规范/TASK/system/tooldescription，也不开始真实实验。

## 实际问题

FT09v161把共享格一致性写成EXACT/validated，但18tile目标未WIN；RESETguide与retry_state冲突，knownfailed标签无试验起点/动作/观察，fresh上下文重新分析14min。v549笔记同时列1024坐标和“divide16”导致两次doublemap，此项属于已修harness表达。最终WIN不证明探索notes一直正确，VISTA最终GUIDE也不是探索前oracle。

## 可选方案与推荐

A. 每次play强制write笔记：容易制造大量重复tokens/toolwrites，也可能占用无进展guard；不推荐。
B. 宿主从Game/图片推导规则并写GUIDE：越过agent/Environment边界，污染公平评测；禁止。
C. 只在规则被反证、Level切换、RESET/checkpoint前维护紧凑作者笔记：推荐，复用现有writeguide/writeworking，不增加tool/schema/强制write频率。

需要用户评审的是明确新增模型指令（相对VISTA基线偏离），不是伪称原prompt字节不变。建议独立可开关experimentpromptaddendum，但如何配置/是否公开flag需评审，不能直接扩大CLI。

## 轻量内容结构（作者文字，不是JSONschema）

GUIDE跨Level规则：
- 已观察事实（Turn/Frame锚点、适用palette/level）
- 当前假设（置信来源，不把一致性当WIN）
- 已否定假设（哪次试验、起点是否干净、观察/反证）
- 未解决差异与下一最小可区分试验

WORKING当前任务：
- 当前Level/Attempt/Turn，当前棋盘状态或parity，明确坐标域visual1024
- 当前目标、下一动作预期及失败判据
- 试验台账：起点、动作集、结果、状态污染、是否被否定
- RESET后继续的最小内容；哪些旧GUIDE结论已失效

不要在笔记中复制长thinking或整个pixelgrid/history；保留证据定位，必要时inspect/history读取。宏观rules与逐局具体coords分开。模型笔记始终是hypothesis，不取代receipt/commit。

## 验证指标

离线：固定作者notes在RESET/checkpoint重启正确传递，conflictingprooffailclosed、1024coords不会重映射、部分write不active。这些已是工程regression，不测语义理解能力。

真实实验另行授权，固定officialprovider/game/model/max/seed/budget/sourceDigest，baseline与notesaddendum分别多次运行；记录恢复后请求/时间/重复失败试验/无效坐标/读工具/动作/输出和cache。不能用笔记写入次数/长度代替quality，也不能修改旧notes造改进。

停止规则：不自动超过预算，不为了笔记策略无限付费复跑；解释影响有限样本，不将modelrevision随时间变化归因prompt。优先用既有FT09记录作人工rubric，再决定小范围A/B，而不是马上整局多次跑。

## 既有 FT09 笔记的人工 rubric（不重跑模型）

先用四项可核对的问题标注，而不是根据长度或写入次数打分：①事实/假设/反证是否分开；②当前状态/试验起点是否清楚；③下一动作与失败判据是否具体；④恢复时坐标域、GUIDE与WORKING是否一致。

| 笔记对 | 已有优点 | 可定位不足 | 可验证改进目标 |
| --- | --- | --- | --- |
| v18 GUIDE / v19 WORKING（Turn5） | 剩余6步/1024坐标/每步预期/未解决项明确，随后L2完成 | GUIDE标题confirmedL1/L2但L2尚未WIN；部分toggle可逆仍为假设 | 只将已观察机制确认，未成功目标仍列候选 |
| v161 / v162（Turn52） | 具体棋盘/坐标/18步试验及失败fallback | shared-cell一致被写成EXACT；失败后长时间未撤回，mini自身状态未覆盖 | 引用失败Turn并明确反证；干净起点与状态污染记清 |
| RESET retry_state / 旧v161（Turn180） | 多个候选集与失败标签保留 | knownfailed标签缺起点/动作/观察定义，与GUIDE旧结论冲突 | 恢复正文明确旧假设作废，并保留最小可查证试验台账 |
| v549 / v550（Turn180后） | same/different规则与mini可点击修正，最终L5完成 | native/display单位混淆导致Turn181/182无效；14步候选被叫solution但仍追加试错 | 已由harness坐标域修复；剩余候选计划仍保持可证伪表述 |

这是对已保存作者笔记的人工标注，不推断VISTA探索前已知规则、不修改旧notes。新策略验收要比较恢复后不必要重读、重复被反证试验与错误坐标；不能只说“多写了GUIDE所以好”。

## 本阶段最小实施与边界

基线为 d15d09b + b89a371，已落入本线程 main。采用 C 形成离线候选，仍不是 accepted 规范修订或生产默认策略。新增 `scripts/lib/note-policy-experiment.mjs` 仅向离线调用者提供 `selectNotePolicyPrompt(baseline, strategy)`：显式 `baseline` 逐字返回原输入，`notes-v1` 在原输入后追加明确标记的 **新的 agent 策略**。无隐式环境变量、正式 CLI flag、SDK 参数、工具/schema/description 或生产 runtime 接线；因此正常 Run 仍使用原任务提示基线，不声称新增 addendum 后逐字/逐行为对齐 VISTA。真实调用仍须另行授权。

反证时撤回或收窄 GUIDE 的相关假设，记录试验条件；污染或起点未知的失败不能当干净反证。RESET 前可以先更新 GUIDE；若无法更新，retry_state 必须明确引用陈旧结论和反证，不让宿主选择哪套游戏规则正确。retry_state 区分旧状态与 RESET 后待观察状态，不能提前宣称新 Attempt 已成立。Level 切换后不把旧 WORKING、palette 或坐标当新 Level 的事实。

checkpoint request 生效后所有普通工具受规范 gate 拒绝，所以只能用 `save_compact_checkpoint` 同时提交 GUIDE/working_memory；GUIDE 仍一致才可传 null。策略不要求 gate 内额外 write，不改 RESET pending/commit 或 Level archive 的工程规则。

## 离线验收与尚未测得的效果

模块复用上述四组 FT09 rubric，输出 `offline_manual_review`。来源只是已提交的工作质量评审摘录，不是重新读取原始 run artifacts 的审计；保留 pass/fail/unknown，不自动根据词汇或笔记长度打语义分、不改历史作者笔记。v549/v550 坐标冲突记录为历史已修 harness 问题，不能归为新策略接线失败。逐项注释及来源在模块中，unknown 不计为通过或失败。

自动测试验收：baseline 输入字节保持、notes-v1 独立标记、未知选择拒绝；策略覆盖反证、污染、RESET冲突、Level清理、checkpoint gate 和 visual1024；四组人工标注来源存在、缺证据保持 unknown、效果明确未测。提示文本测试只证明指令存在，不证明模型服从。既有 recovery/partial-write/坐标 proofjoin 回归继续由完整门禁验证。

离线报告可在项目根目录运行（不创建 Environment、不调用 provider、不读取 .env）：

```bash
node --input-type=module -e 'import { offlineNotePolicyReport } from "./scripts/lib/note-policy-experiment.mjs"; console.log(JSON.stringify(offlineNotePolicyReport(), null, 2))'
```

未来另行授权的小范围 A/B 应冻结同一 source digest、Game/seed、official provider/model/revision（无法冻结则披露）、预算和恢复锚点。验收先看恢复后请求数/耗时、重复已反证试验、错误坐标、反证到作者更新的延迟、动作与输出 token/成本；同时检查 GUIDE/retry_state 是否一致及试验起点/动作/观察是否可查。记录负例和 unknown，不能用写入次数/长度替代质量，不能用历史 WIN 或零网络离线测试宣称收益。暂不设无证据的改善百分比，不启动付费整局或 WP-10。
