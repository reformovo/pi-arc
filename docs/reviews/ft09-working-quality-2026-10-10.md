# FT09 WORKING / 规则总结效果分析

基于run-artifacts/ft09-deepseek-20261010T083530Z实际knowledge/domain/pi-session，及VISTA历史ft09codex_visible/GUIDE.md。只读分析，不修改agent笔记/策略、不跑新Game。传递完整性已测试不等于语义正确性。

## 已有用处

Turn5写GUIDE v18、WORKING v19：规则、具体坐标、剩余6步、每步预期、未解决问题清楚；Turn11完成L2。后续最终v549修正了“minis也要点击”及same/different语义，v550给14步计划；Turn214成功L5。说明模型能沉淀规则，并在边界后修正，而不是笔记机制无效。

实际tools：play227、read_pixels27、inspect5、write_guide3、write_working3、history3。知识版本不是549次写入，version来自ledger序列：guide18/161/549，working19/162/550。

## 关键问题与证据

### Q1：未成立的假设升级成已确认规则

v161(同Turn52/L5/Attempt1)包含LEGEND 'validated by all shared-cell cross-checks'、'EXACT mapping derived'，却仍含 'G-sub? -> hmm'；目标18plain tiles而只读minis中心。v162计划18个tile，并把失败后fallback当反向颜色试验。这只是几何/共享格一致，不是WIN确认，更未覆盖mini自身可点击状态。Turn70完成18-set仍不成功，最终v549自己记录该失败证明原读法错。GUIDE在Turn52后到RESET前没有修订，127个L5点击继续扩展试错。

应区分observed/inferred/disproved/confirmed-by-level-completion。共享一致性不是完整机制验证；失败时尽快更新被反证的规则，而不是保留CONFIRMED文字。

### Q2：RESET恢复完整但GUIDE语义陈旧/与WORKING冲突

Turn180 RESET boundary交付的是v161旧GUIDE（18目标、早期progress状态）+新的retry_state WORKING（六个candidate集合、约14个knownfailed标签）。这些标签如X/F/NF-RB等没有完整解释/动作与结果定位；恢复后无法仅凭标签知道试验条件/状态污染/反证了什么。不存在持久数据丢失，是作者笔记摘要质量不足。

RESET09:23:57，v549/v550直到09:38:33才写；约14分36秒history/inspect/read_pixels重新分析，期间无GameAction。guard最大11/16、没有stage升级，属于大额但最终有效的只读/推理恢复。

应同一次RESET提供互相一致的GUIDE和retry_state；旧GUIDE若不能更新，retry_state明确标注哪些旧结论被推翻，不要求宿主编造新笔记。

### Q3：确定的坐标单位错误造成两次无效Action

v549写 'pass NATIVE coords=screenshot_px/16 ... verified working'，v550末尾写 'pass x,y divided by16'，同时列出的计划又标1024space。公开play工具要求模型传0..1023，宿主自动映射到0..63。

实际session play：Turn181/182模型args=(33,7)，domainintent/receipt=(2,0)，两次finalRawFrame相对前Turn变化像素数均0。Turn183模型args改(528,112)，receipt=(33,7)，变化36pixels。证明前两步是doublemapping错误，不只是计划里出现一种表达方式。

较早模型一直正确传1024coords，例Turn52args144,368→native9,23。v549误把history中的nativeAction当模型应传坐标，这也暴露模型可见history/recovery的数据坐标域不够明确的风险；应优先标注/投影坐标系，而不是容忍小数值意味着native的猜测。

### Q4：当前状态、试验基准与计划维护不足

v162长期停留Turn52“两次同格点击netgreen”，之后候选切换多数靠长对话，笔记未维护每个mini/tile parity。retry_state有目标集合但没有完整失败表（起始状态、点击集、观察、反证、污染）。v549提到t98失败因先前M8污染，说明此前对照不是干净起点；这类状态污染会造成规则判断错误。

后RESET所谓14-clicksolution也未14步结束：Turn183开始正确坐标，直到Turn214才成功。计划是候选，不应称保证正确solution；应按实际反馈更新状态与否定项。

## VISTA对照

VISTA历史GUIDE最终总结：核心为special对邻格颜色的claim；white=same-as-core、gray=different、void；L5有可点击phase的special，L6有coupling，当前坐标变化需重读。比pi-arc v161的绝对颜色legend更可迁移，避免把当前palette当全局机制。

但VISTAGUIDE是通关后最终文本，不能证明它在L5探索前已拥有该正确总结。两边seed/puzzle布局可能不同（VISTA L5描述7x5+3pinwheels，pi-arc L5 staircase7x7+11minis），不能把VISTA具体solution当本局groundtruth或直接注入。

## 建议优先级

1. 修复/明确模型可见action坐标域：play输入1024，receipt/history可能native64，两者标识或一致投影。加“history→模型计划→play”回归，避免再doublemap。
2. 加轻量规则总结模板：事实/假设/反证、适用levelpalette、当前parity、下一最小可区分试验、剩余预算；不强制每步write。RESET前要求旧GUIDE冲突明确标出。
3. 验证笔记效果用具体指标：恢复后重新读取次数/耗时、重复失败试验、错误坐标、行动前预期与反证更新，不只看写入次数/长度。
4. 不通过宿主从Game代码推导解法，不把history或notes当Environmentauthority；不修改模型作者旧知识来假装改进。

本轮仅分析，不实现模板或公开schema变更。真实RunWIN/audittrue与“notes高质量”是不同验收项。
