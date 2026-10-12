# 阶段收尾与可审阅基线

状态：改动分类、安全范围检查与最终门禁收尾完成，可供用户审阅；未提交/推送，不自动开始WP-10或新真实Game。独立审阅因模型服务过载未完成，不把它当作批准。HEAD基线6bfe23ea981da2a4894b47c97e5951ed28224e57+当前可见工作树。关闭状态以issue-closure-checklist-2026-10-10.md为准，不声称所有问题已解决。

## 改动分组与推荐审阅顺序

1. 生产正确性：sidecarstdout隔离、RESET生命周期、权威逐Actionbudget/cancel、Action拒绝分类、thinking能力检查、audit惰性模型配置、artifactfsync、严格恢复proofjoin和坐标1024投影。
2. 运行政策/观测：VISTA窗口-72k/-32kcheckpoint、Go图像容量checkpoint（official不限此64）、普通tool无进展16/stage/一次continuation一次fresh、providerusage+真实serialization前缀HMAC。政策扩展应单独审阅，不以“复制提示词”掩盖行为差异。
3. 质量与regression：deterministiclifecyclefixture无RESET广告、controller/Python/CLI/process/knowledge/metrics各回归；check:spec排除rootruntime生成笔记而保留项目维护文档。
4. 诊断工具：cache离线branch重建、8requestsyntheticprobe、targetedRESETdriver/setupsource、单次coordinatecontractprobe。默认offline；live须显式标志/官方hostguard/有限预算。诊断不是SDK新tool-driving功能、不是Gamebenchmark。
5. 文档：保留失败/inconclusive/更正数字与成功记录，实验报告不打包运行产物或密钥；feedbackdraft仅草稿，Go调用与外发暂停。

不自动把这些内容gitadd/commit；建议审阅后按上述分组提交，避免单一巨大“修复所有问题”commit。没有改package.json/package-lock.json/pyproject.toml/uv.lock；不擅自依赖升级。

## 已有真实证据

- officialcd82：121Action/WIN6/6/34m14.6s/cache99.65%/audittrue，无RESET。
- officialft09：227Action含1RESET/WIN6/6/74m11s/cache99.63%/audittrue，真实GAME_OVER→RESET→fresh→继续通过。
- Go图像checkpoint局：104Action/WIN/2容量checkpoint，但cache21.14%不作为性能成功。官方与Go位置synthetic对照支持渠道差异，#51993同型，不声称服务端已修。
- officialsynthetic坐标probe：一次input408120→native25,7命中，output179；仅受控契约，不外推正常FT09完整恢复。
- 普通Game定向小预算多次inconclusive完整保留；诊断floatcost错误已修，未改旧archive。

## 安全与提交范围

主线程扫描Git候选（tracked+untracked、不包含ignored.env/artifacts）229个文件，APIkey-like/GitHubtoken-like模式无匹配，仅输出位置/类型不输出值。.env及.env.*忽略，.env.example空key可分享；gitindex没有.env路径。该扫描不是完整secret证明：不验证账户密钥撤销，不扫描ignoredcredential内容，不确认供应商凭据权限。

实际密钥曾经在共享编辑通知暴露，用户必须在服务方轮换；Git ignore不能防止共享工作树编辑同步。不得将新的key填入共享Delta文件。文档中的publicURL不是secret，报告不能保存auth/header/request正文。

## 门禁与收尾项

最终生产+diagnostic组合门禁已通过：Node22.23.1/npm10.9.8/Python3.12.9，npm run check（TS293/Python33/contracts4+4/integration85）、npm run build、git diff --check以及依赖manifest/lockfile无改动检查全部成功。Coverage statements90.64%/branches86.34%/functions95.46%/lines93.99%，原门槛不降低。

离线diagnose-cache.mts已替换为受Biome/checkJs/types门禁的scripts/diagnose-cache.mjs，使用compiled dist imports，先build再执行；无any/suppression。old/new在两个historicrun的完整numericJSON逐byte相同：旧172/344mock/raw0/bound91、新145/290mock/raw0/bound0且segments64/67/14。不修改production或实验结论。历史.mts语句保留为当时执行事实，当前reproduce命令见cache-prefix报告。

独立productionreview两次服务overload失败，没有具体报告，不声称reviewapproved；主线程通过已有regression/fullgate与手工范围核对作为当前验证证据。进一步独立人工审阅仍推荐，未自动提交。

剩余：笔记语义策略待评审；真实token容量checkpoint未触发；跨平台/磁盘full/powerloss/运行资源budget未完全验收；依赖安全告警待专项核实；modelrevision/多样本冻结不足。阶段收尾不把这些变为已关闭。

## 下一阶段

在稳定基线可审阅后评审轻量笔记策略（见../design/knowledge-summary-policy.md），不立即修改TASK/systemprompt。只修改必要harness表达的坐标/attempt缺口已完成；后续模板是新的agent策略，要单独标记相对VISTA偏离并明确验证指标。
