# OpenCode 相关 issue 检索

通过GitHub公开search/issues API检索repo:anomalyco/opencode，包括open/closed；读取重点issue正文及评论。没有发布issue/评论、账户信息或复现材料。下列状态为本轮查询时状态，可能更新。

## 首选：与本次问题几乎同型

https://github.com/anomalyco/opencode/issues/51993

标题go: deepseek-v4.1-flash prompt cache regresses to the first image whenever a new image is added，open。报告新增图片时cache只到首图，下一文字请求恢复，原HTTPprefix不变；rawHTTP也复现。用户评论提供同payloadDeepSeek官方API正常对照；Go路由观察到orcarouter-dsv4.1flash。其他复现者指出1047bytes小PNG也能触发，所以不能认定大图size阈值。

关键评论：
- 官方直连正常/Go回退：https://github.com/anomalyco/opencode/issues/51993#issuecomment-5905804725
- 小图亦复现：https://github.com/anomalyco/opencode/issues/51993#issuecomment-5942138585
- 同bytes重放一度正常，最后确认prefix已暖：https://github.com/anomalyco/opencode/issues/51993#issuecomment-5959738910
- 清晰归因限制：https://github.com/anomalyco/opencode/issues/51993#issuecomment-5960135323

新session UUID不等于cold content prefix；cache hit可延伸进新请求本身，可能复用更早实验完整image-bearingprefix。因此未来复现需要cold/warm分开，nonce只在每个实验开头生成一次并在整个配对内固定，不能每请求改变nonce破坏prefix。它们是社区分析，作者association NONE，未找到维护者确认根因或修复的证据。

## 相关但不同类

- https://github.com/anomalyco/opencode/issues/50258 （open）：DeepSeek-V4.1Flash部分Go upstream缓存反复丢失；评论byte-identical body/header/session也可波动，涉及副本/eviction/routing假设。可解释图像之外miss，但不等同确定性的imageprefix回退。无维护者确认所引内部原因。
- https://github.com/anomalyco/opencode/issues/41125 （open）：早期Go重复请求cache0；后续评论从稳定99%到间歇~50%，指向#50258。不支持“当前Go全部不缓存”的笼统结论。
- https://github.com/anomalyco/opencode/issues/51985 （open）：Anthropic boundImages每次重新裁剪旧图改变历史prefix；对应pi-arc已修复的滚动删除问题，不是当前actualprefix稳定后的服务端图像问题。
- https://github.com/anomalyco/opencode/issues/53304 （closed/not_planned）：旧图裁剪集合重新计算导致变回live。评论显示因不满足issue模板被bot自动关闭，不能称为代码已修复。
- https://github.com/anomalyco/opencode/issues/51580 （open）：ZCode/Codex命中差异并猜测prompt_cache_key，但只有不同client统计，缺受控因果；不把此猜测当添加privatekey依据。
- https://github.com/anomalyco/opencode/issues/45606 （open）：Go缺失reasoning/cache usage细节与官方直连不同；属于gatewayusage归一化问题，不自动证明本次hit数字错。
- https://github.com/anomalyco/opencode/issues/47487 （open）：其他Go模型超过图片数量上限使session卡死；相关容量正确性，模型/50上限不同，不可移用成DeepSeek64/600承诺。

## 建议

不重复开新issue，优先给#51993补充本次合成图文位置配对及官方直连对照（若用户明确确认外发）。保留#50258作为额外非图像cachemiss背景。公开提交只使用无敏感结果，不能附.env、账号、本机路径、Game转录或private payload。之前反馈草稿尚未发送，补充既有issue比泛化新报告更有针对性。
