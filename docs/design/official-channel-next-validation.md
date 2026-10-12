# 官方渠道后续可靠性与跨游戏验证

用户批准先离线无进展保护/边界恢复质量，再验证第二Game。OpenCode真实调用与反馈继续暂停；不降低max、删除reasoning、变更tool限额。

## 无进展保护

现有host仅在整个模型operation结束后判定无进展，连续schema/Action拒绝或成功只读循环可一直付费，logwrites不等于游戏进展。推荐内部每个authority anchor（Turn/observationDigest/Attempt）最多16个普通工具尝试，再交给现有一次continuation、一次fresh recovery、最后model_no_progress政策。包括schema拒绝，不以笔记/日志更新重置；checkpoint/RESET保存与已admitreceipt不能被误杀。此保护是本次明确授权的Pi策略扩展，不声称VISTA阈值或新publicCLIflag。

验收：无效play和只读混合无限loop有界；Pi schema-invalid也被计数；已admitreceipt先settle不重发；新commit重置；checkpoint与cancel/budget不冲突；重启恢复必要counter。内部16为容许多次合理inspection的安全阈值，不是对任务性能的证明。

## 边界内容质量

验证commitmarker、lastAction/receipt/Observation/currentLevel history join与GUIDE/WORKING正确；恢复材料不能从Pi transcript反推authority或伪造摘要。Level清空WORKING前保留归档，checkpoint失败/中断不解锁动作；fresh模型收到已验证规则、未解决假设、当前目标和视觉。只改缺失权威关联和回归，不强迫每步写GUIDE或改提示词。

## 第二Game选择

选择ft09-0d8bbf25。VISTA历史run_20260911T034601Z记录WIN/6关/174 Action/0RESET，实际174个Action均为ACTION6。与cd82混合键盘/点击不同，适合较短的纯点击泛化验证。VISTA baselines43/12/23/28/65/37仅用于评测，不给模型解法或复制Game资产。

离线验收通过后，officialdeepseek/deepseek-flash/max/actionBudget400，统一resolver获取官方Game，不从VISTA复制；无旧笔记/经验注入。记录每关Action、无进展guard/拒绝、cache、prefix、notes、RESET/checkpoint/terminal/audit。单局不作为稳定能力提升结论；真实tokencheckpoint长任务另选，不能认为ft09必然触发。

当前状态：边界内容质量修复已合并，19个focused用例、types/Biome/diff通过；真实ArtifactStore/KnowledgeStore fixture证明多Level归档、RESET/checkpoint中断交付恢复、缺失digest/intent/receipt和冲突action/Observation/baseanchor failclosed。非初始Turn不能以简化fixture为由放宽证据；history仅到suppliedauthority且包含committedAction。没有修改prompt、写笔记频率或虚构内容。

无进展保护已合并：16普通工具attempt/anchor/stage；无限invalid/inspect/mixed48后按既有一次continuation/一次fresh/model_no_progress终止，schemainvalid计入，pendingeffect先结算，重启counter/stage/admission恢复；checkpoint/RESET优先，新Turncommit才重置。内容fixture证明作者明确写入的规则/假设/task能正确传递，不证明真实agent一定会写好笔记。

主线程组合npm run check/build/git diff --check通过（Node22.23.1/npm10.9.8/Python3.12.9，TS253、Python33、contract各4、integration85），原coverage门槛未降低。

第二Game已启动：run-artifacts/ft09-deepseek-20261010T083530Z，officialdeepseek/deepseek-flash/max/budget400，通过resolver获取officialGame，模型无VISTA解法/旧经验注入。结果待监测。未自动开始WP-10或提交代码。
