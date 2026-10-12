# 长普通文本与图像位置的缓存实验

用户批准下一步，继此前tiny/large/tool/reasoning受控实验。长reasoning字段虽发送但未增加usage，不作为有效长上下文。因此改用服务端reportedusage可验证的普通文本。

## 计划

两组long-before/long-after，每组固定8请求（base/repeat,text-extension/repeat,sameimage-extension/repeat,newimage-extension/repeat），最大16，output每次256总4096、retry0、单请求120s/global每组12min、失败停止。

固定opencode-go/deepseek-flash/max和publicwrapper；同一份4倍合成长文本与确定性1024图，long-before的base内容为image→text，long-after为text→image。除basecontent顺序外，system/messages长度/extension配置一致，无thinking/tool结构变量。session各组独立但组内固定；跨session cache可共享，不能把首请求必然视为cold。

第一非零usage必须证明完整输入（input+cacheRead+cacheWrite）>=20000，否则记录usage_scale_not_reached并停止；char/4只是预算代理，不能冒充实际tokenizer。使用普通synthetic文本，不包含Game/privatecode/历史transcript。

只保存安全metadata：图片/text数量与顺序标签、HMAC/prefix等值、usage/timing/stopReason。observer返回undefined、不改wire；不保存payload/header/auth/模型正文/异常原文。若新图追加在两个顺序间cache出现分歧，支持视觉位置相关变量，但不能证明具体server algorithm。

## 状态

脚本/离线tests实施中；真实16请求未开始。不更改runtime策略或真实Game。
