# 笔记语义策略：待评审，不修改生产提示词

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

## 当前待决定

是否采用C并允许额外addendum实验？是否先人工标注已有三版GUIDE/WORKING形成评测rubric？推荐先人工rubric和设计审阅，稳定stage代码提交后再实验。本文无已实施模板或收益承诺。
