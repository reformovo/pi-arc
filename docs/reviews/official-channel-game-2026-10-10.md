# 官方 DeepSeek 渠道真实 Game 验证

用户决定暂不用OpenCode，借官方渠道继续。Go反馈未发送；暂停Go真实实验，保留历史结果，不偷偷删除兼容adapter。

## 当前运行

Run run-artifacts/cd82-deepseek-official-20261010T060740Z，cd82-fb555c5d/providerdeepseek/modeldeepseek-flash/max/actionBudget400/gameOffline。官方api.deepseek.com、OPENAI_API_KEY配置存在性检查不回显值；不读取/抄录.env。使用同一verifiedGamecache，无下载。

Game digest883bc976082536041dc59b97c75bcb130e26beaaf8fcf5fe65690c9c07c25d66，seed42；公开directmodelmetadata1Mcontext/384koutput。VISTA tokencheckpoint928k/968k；Go实测64图片cap只用于opencode-go，官方direct不推定同上限。

运行开始2026-10-10T06:07:40Z，Turn33/58完成前两关，Turn158进入第3关GAME_OVER。之后模型多次RESET被错误拒绝，主线程2026-10-10T07:17后确认双端membership校验问题并SIGTERM停止自己启动的processgroup，防止继续付费无进展循环。没有伪造normalterminal；原始archive/logs完整保留，operator-stop.json记录干预，不能将其报告为通关/完整audit成功。

根因：真实SDK GAME_OVER.availableActions仅ACTION1..6，不列RESET；TScontroller和Python sidecar都把RESET按普通Action列表校验，违背既有GAME_OVER后RESET生命周期规则。模型31次RESET尝试中多次有合法retry_state，不是简单agent无恢复意图。fixture之前显式包含RESET，隐藏真实SDK差异。双端修复与不含RESET的GAME_OVER回归已合并；RESET独立生命周期规则、GAME_OVER+retry_state、普通动作availability和budget/cancel保留。主线程锁定Node22.23.1/npm10.9.8/Python3.12.9 fullcheck/build/diff通过（TS234/Python33/contract各4/integration76）。

真实无模型SDK重放验证：全新sidecar用seed42与同verifiedcache重放旧158receipts的动作，逐动作resultState一致，重现GAME_OVER/ACTION1..6/noRESET；RESET成功receiptcomplete/Turn159/NOT_FINISHED/levelsCompleted2，同actionId重复receiptDigest一致，temp清理且旧artifacts不改写。

修复后新局run-artifacts/cd82-deepseek-resetfix-20261010T072708Z已成功：同官方provider/model/max/budget400，模型freshcontext，无旧转录/解法注入，不假装旧Runattach（原Environment已终止）。WIN、121 Action、6/6、exit0，07:27:09.856Z→08:01:24.448Z，共34分14.6秒；各关Turn30/36/60/77/99/121。锁定Node22 audit exit0/ok=true，ledgerhead与terminal一致。

139provider响应full39020183=cache38883328+uncached136855（cacheWrite0），加权hit99.6493%；新增图片组122请求hit99.6431%、同图组16请求hit99.7276%。output323979包含reasoning308585。138可比actualprefix全部append-only，system/tools/optionsstable；segment1，图片1→127，无工具错误。官方Gamecache优势真实验证成立。

本局没有GAME_OVER/RESET/checkpoint，不能把WIN误报为liveRESET再次验证；RESET仍以完整fixture回归与158Action实际SDK重放证明。provider/backendrevision与Go不完全同条件，单次动作数不作为能力优劣结论。

停止前最终记录250responses/251initiated，cache90129024/full90449251=99.6460%，imgmax201；newimagegroup99.5963%、sameimagegroup99.7829%。249非initialprefix观测append/system/tools/optionsstable。elapsed71分05.5秒；无normalterminal/audit未执行。这是officialcache优势证据，不代表Game策略已通过。公开requestmetrics/prefixHMAC记录不含正文/凭据，完成后统计WIN/Action/level/usage/新增图片cache/duration/checkpoint/audit。启动前锁定Node22.23.1 build与diffcheck通过；此前完整check已通过（TS231等），本次无业务代码更改。

## 对照限制

与Go不同provider/auth/backend，不能当“只改host绝对同revision”实验。Go104/106Action结果仅参考；officialsynthetic16requests新增图97.60%/repeat99.30%，不能预先外推整Game缓存已好。此文件不声称通关或audit成功直到actualterminal。
