# P2：恢复场景离线对照与 FT09 交付归因

状态：离线场景实现及只读轨迹核对完成；不修改生产行为，暂停P3决策。本文不是 accepted 规范。

## 范围与方法

沿用P1 VISTA V0 `63c8843822cb371bb52a59f0cee18c4020f2494b`，pi-arc runtime 保留 b89a371。VISTA expected 来自P1固定源码人工核对；本轮不执行/导入VISTA，不创建真实Game，不复制资产/解法。新增测试在既有两个unit文件，直接调用ModelToolExecutor及真实ArtifactStore/KnowledgeStore/RuntimeKnowledgeBridge。它们是现状 characterization，不是对齐修复或模型语义 scorer。

适用指令检查未发现AGENT.md/AGENTS.md。只读历史 FT09 的 domain/runtime、版本笔记、归档raw frames及pi-session消息条目；不读.env、凭据、provider认证头；不复制整个session（约202MB）或provider正文入仓库。解析session的JSONL批次，仅取已落盘message/工具参数、正文结构和笔记digest。以下定位均相对旧run `ft09-deepseek-20261010T083530Z`。

## 新增离线对照（P3 修复前的 characterization）

| 场景 | V0 expected（固定源码） | 当前实际/验收 | 结论 |
| --- | --- | --- | --- |
| history无范围limit=2 | controller:1143–1146，从matching末尾取2条 | **P3 已修复**：fixture Turn0..4 返回3/4；回归锁定最新优先 | 原差异已在不改shape下修复 |
| history显式范围2..4 limit=2 | 从matching开头取2条 | 返回2/3，truncated=true | 选取方向对应；record结构不同 |
| history事件动作 | controller:1063–1083 public action+result | 仍包含actionId/Observation，无action/x字段；本轮不直接暴露动作参数 | 作为独立 P3 议题保留，需先决定是否属于 accepted schema 必需字段和如何使用 visual1024 投影 |
| attempts limit=2 | controller:1100–1115限制Attempt个数，当前Level摘要 | **P3 已修复**：先聚合3组，再返回最后2组；回归锁定按Attempt计数 | 原差异已在不改shape下修复 |
| recovery 128边界 | V0 controller:1162–1216按Attempt汇总，无按128动作截断 | 127个Action+Turn0恰128条；到Turn129仅Turn2..129；所有Attempt1记录丢失，无truncated字段 | 证据仍在archive，恢复seed确实丢失早期Attempt信息 |
| retry笔记冲突 | V0 retry_recovery_prompt:31–44带saved_at/content，不裁定解法 | GUIDE和相矛盾retry正文原样保留；重开后完全相同；知识内部anchor/version有效，正文无saved_at | 传递完整≠语义一致；不能让宿主判规则谁对 |
| 无notes | V0 controller读取不到为None→null | 内部null，恢复正文两项为空串 | 明确非等价，不自动改成新结构 |

截断fixture通过合法intent/receipt/commit写入真实临时store，覆盖128边界和RESET后的Attempt2标签；它不验证游戏是否合法可解，不是Game replay。已有生命周期测试承担RESET admission/GAME_OVER的独立责任。初版255动作durable写入超过5秒，已缩至129动作；仅该I/O测试设20秒局部超时，不改全局配置或生产预算。

## 其他关键场景：复用既有检查

| 场景 | 已有证据 | 本轮能够证明/不能证明 |
| --- | --- | --- |
| 初始上下文 | model-prompts测试；pi-arc-host:363–437 loader/runtime/image接线；pi-runtime integration | 原始task/hash、初始段落和公开Pi传递；不证明VISTA metadata键名相同或模型服从 |
| 普通play/拒绝 | model-tools/运行控制器；pi-runtime同response single-play测试 | 拒绝不造环境动作、play后先观察；包装差异保留，不主张同wire |
| RESET/fresh | knowledge-store原子retry、boundary重交付；pi-runtime fresh admission | 版本/交付重试不重发RESET；与VISTA新session仅领域语义对应 |
| Level | boundary fixture和knowledge-store清理归档 | GUIDE延续、旧WORKING移除、当前Level标签；不继承解法 |
| checkpoint | knowledge-store partial-write/原子commit；pi-runtime gate/fresh | checkpoint请求后工具门控、notes/游戏状态一致；不能替代真实token容量验收 |
| 未结算Action恢复 | boundary proofjoin、runtime settled/openoperation tests | 精确已提交Action/Observation先交付、不重发；矛盾proof fail-closed，不把作者文字冲突当proof冲突 |

## FT09 原始交付事实表

| 位置 | 只读核对事实 | 归因 |
| --- | --- | --- |
| domain序列160–162，Turn52 | GUIDE v161/WORKING v162，模型write参数SHA与snapshot/contentDigest对应 | 未见写入丢失；局部一致性写成EXACT是作者表述 |
| domain216，Turn70 | 候选18-set后未Level完成；之后直到RESET前没有新的GUIDE/WORKING write | 可以确认没有笔记撤回；不能把所有后来重复点击计为重复失败试验 |
| Turn71、Turn98与v549 | Turn71点击native(25,39)，对应笔记M8位置；v549自述t98 polluted | 先前点击可定位；“t98不可判定”有作者说明，但本轮未推导隐藏mini状态或认证游戏规则 |
| domain546，Turn180 | RESET commit，Attempt2；retry正文966字符，digest 57fccf66485fb5316155718317d307e460e60fd2766199950c42efc4ad75a048 | 环境边界已提交；不是capacity checkpoint |
| domain547/548；session JSONL行502351、message id 01a12520-5460-75cd-9016-d4640054d144 | 09:23:58.176Z fresh user消息含1图；GUIDE正文逐字等于v161（SHA 20205c2663fb3ac122f3718ec65b4c2037ff4683554d6eda69594fe844882494），WORKING逐字等于intent retryState | 实际交付证据，不仅是生成器测试；没有notes丢失/错误版本证据 |
| 同fresh消息 | history list长度128、Turn53..180；首动作native(25,7)；last_action无Level/Attempt标签；notes为字符串 | 属修复前投影；不将它当作修复后现状。遗漏Turn50–52，不能量化对模型影响 |
| 恢复后history调用 | attempts无范围；events范围0..127/limit128和128..180/limit64 | 模型主动重读；显式分页覆盖旧Turn，但当前events无动作参数的缺口不能由次数推断补齐 |
| domain549/550，09:38:33.689/.988Z | v549/v550模型write正文SHA分别与snapshot对应；旧v161在Turn70失败后约42分13.6秒才出现后继GUIDE | 未撤回窗口可测；不证明模型对话中没有修正认识 |
| session plays181/182；rawframes180→181→182 | 两次参数(33,7)，native(2,0)；raw像素变化0/0 | 已知doublemap旧harness表达+作者误解，不能归为待改新策略 |
| play183；raw182→183 | 参数(528,112)，native(33,7)，raw像素变化36 | 后续有效变化；raw改变不是完整规则验证 |
| domain652 Turn214/691 Turn227 | L5完成/最终WIN | 不能回溯认证早期EXACT或候选solution |

所有6次note write参数SHA与18/19/161/162/549/550的snapshot摘要相符。retry恢复正文逐字对应intent；本轮没有重新运行完整audit，因此这里只声称针对性对应核对，不声称完成整archive再审计。frame比较使用已归档整数pixels，不重新渲染Game。

## 恢复成本（历史观测，不是对齐收益）

计时口径为fresh用户消息时间09:23:58.176Z至首次GUIDE修订09:38:33.689Z：875.513秒（14分35.513秒）。用provider_request的requestId连接request/response，仅统计该fresh之后发起且截止前结算的5个请求；sumduration870809ms，output203834、其中reasoning198365。completed工具history3/inspect2/read_pixels3；不把RESET的迟到tool.completed算成新的Game Action。

若从RESET Turn commit 09:23:57.661Z开始计时，则到GUIDE修订为876.028秒。两种起点相差0.515秒，应明确口径。没有有效Game Action直到后续Turn183；不能用这段耗时单独证明history形态导致全部重新分析。

## 决策建议：供P3审阅，不自动修复

1. **history 已部分修复**：无范围 events 取最新记录，attempts 在聚合后按 Attempt 限制；这两项不改变公开 shape。events 动作参数仍是独立议题，不能把 public ToolResult shape 默默换成 VISTA。
2. **恢复seed截断**：确有丢早期Attempt信息；P3应比较“显式范围/截断信息”和“VISTA per-Attempt summary”，给最小diff后由用户选择，不同时扩大所有history接口。
3. **notes provenance**：内部锚点/版本完整且正文原样交付；没有证据证明丢saved_at是14分钟分析的原因，优先级低于history。任何恢复正文结构改动需单独确认。
4. **作者语义**：EXACT过度置信、失败标签不足、污染记录滞后已经有证据；在完整交付前提下，不让宿主代写规则、审查或阻断作者假设，也不重启notes-v1。
5. 不依据历史旧坐标错误重改坐标接线，不依据单次WIN宣称对齐或收益。保留现有prompt、公开schema，等待P3授权与范围决定。

## 验证记录

Node22.23.1/npm10.9.8/uv0.8.12/Python3.12.9：完整 `npm run check`、`npm run build`、`git diff --check` 通过。TS298（基线293+本轮5），Python33，contract双端各4，integration85；跨gate数量重叠不相加。TS statements90.64%/branches86.39%/functions95.46%/lines93.99%；Python lines93.98%/branches90.00%，阈值未降低。新增截断测试在完整gate耗时8.761秒，局部20秒上限内。

新旧完整source/prompt/schema/依赖未修改，只有两个测试文件及分析文档。初始定向测试曾因截断fixture的5秒超时失败，已缩小样本和设置局部I/O超时，最终完整gate成功。测试只验证工程内容及差异，不验证模型语义、真实费用或VISTA成绩。不调用provider/下载Game，不修改VISTA/旧artifact/.env，不提交/推送。
