# 最小恢复坐标契约 probe

用户在FT09定向复测多次inconclusive后批准最小契约probe。此验证故意不同于完整Game目标：合成1024图像、唯一绿色cross中心、仅生产play工具可见；不能称为FT09恢复/通关benchmark或正式策略变更。

## 固定预算

只1次officialdeepseek/deepseek-flash/max请求，maxOutput4096、timeout120秒、retry0；truncated/error/aborted/无play即inconclusive，没有下一次请求/强制toolchoice/更换effort。默认离线faux，仅显式live才调用。原始response/reasoning/auth/header/PNG/payload不落日志，仅safeusage/是否toolUse/模型x/y/native映射和targetHit。

## 合成状态与边界

用真实ArtifactStore/生产controller/KnowledgeBridge构造合法syntheticintent/receipt/commit(native25,7)，生成当前生产恢复文本（包含visual1024/canonical replay中心408,120规则），而不是复制另一套坐标提示。图片绿色cross中心在(408,120)，使用高对比长臂提高可见性；接受点击落在nativecell25,7。动作只作用于明确synthetic诊断环境，不执行ARC游戏，不伪造真实GameWIN/成果，不复制FT09解法或私有数据。

任务明确独立测试：观察当前绿色标记，通过play点击中心一次；旧Action是历史，不自动重发。模型可使用当前图像/恢复坐标，工具输入只允许0..1023，宿主真实ModelToolExecutor负责映射。

## 判断

faux408120→native25,7通过；faux25,7→native1,0失败对照；真实完整toolUse+x/y合法、实际parser执行一致、targetHit才证明此契约样本正确。官方模型即使通过也不能证明长期笔记不混淆或所有Game恢复都有效，需要保留关闭清单其他未验收项。

实现与离线验证进行中，真实单次请求未开始。
