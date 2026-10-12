# 第二Game官方验证：FT09

Run run-artifacts/ft09-deepseek-20261010T083530Z，official ft09-0d8bbf25/deepseek/deepseek-flash/max/400Actionbudget；统一resolverofficial获取，不复制VISTA资产/解法。WIN/6关/Turn227/exit0，锁定Node22auditok=true/exit0。elapsed74分11.3秒，首次binding至terminal。

## 实际进度

完成关卡Turn4/11/25/50/214/227。226ACTION6+1RESET；Turn179GAME_OVER，Turn180RESET进入Attempt2，保留4/6，交付freshboundary。此为RESET产生的新Context，不能把runtime checkpoint.fresh词汇误解为容量checkpoint。ordinary.progress max11/16，始终stage0，没有continuation/fresh无进展升级或model_no_progressterminal。

此前进度消息“stage0count1即触发无进展保护”不成立；它只是attemptinventory。模型RESET后超过10分钟只读/推理，最终仍取得进展；次数guard不能等于time/tokenbudget。此次证明没有过早杀死合理分析，但也证明次数限额不保证成本及时有界。

## 模型与请求

261providerresponses，fullinput93777576=cache93427584+uncached349992，cache99.6268%约99.63%。output836083包含reasoning790143。sumproviderduration71分56.3秒，images1–190，跨请求重复包含图像21546次非unique。

259可比requestprefix全部append-only，system/toolsstable；options235stable/24changed，2segmentstarts无对照。变化仅说明allowlist摘要不稳定，未定位变化字段，不能假设是缓存故障或API污染；需要只读检查option构造/输出上限与自动重试captured策略，不能为了数字强行固定。2Contextsegments202/59请求。未发现strictintent/receipt/commitjoin失败。

## 与VISTA参考

VISTA run_20260911T034601Z，174ACTION6、0RESET、WIN6/6。本局多52个点击及1RESET；不同provider/backendrevision/runtime，不能归因单一harness变化。第五关占主要探索失败/恢复成本（Turn50→214中包含RESET）。不能只凭cache99%认为任务效率已好。

## 已验证与剩余

真实RESET→新Attempt→freshContext→继续点击→WIN/audit闭环通过，补齐此前cd82没有RESET的真实验收。边界笔记质量/strictproof新逻辑未阻断运行；但agent策略可改善未被此运行证明。token阈值容量checkpoint仍未真实触发；其他平台/故障矩阵/重复样本待做。

建议下一步先针对第五关分析具体探索与笔记/预测差异及24options变化，不马上开新局。无进展guard已离线证明48attempts终止及重启恢复，本局未达到升级阈值，所以不能声称真实触发终止被验证。若需walltime/token预算，必须明确产品策略与已接受CLI限制，不静默加publicflags。
