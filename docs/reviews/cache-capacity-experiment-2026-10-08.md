# 图片容量 checkpoint 对照实验

## 授权与边界

用户在缓存诊断后授权以ARC checkpoint替代64图片滚动替换。VISTA token阈值保留window-72000/window-32000；新图片容量规则明确是pi-arc服务端兼容策略，不是VISTA原样行为。不得通过删除历史thinking、改provider payload或换模型改善数字。

策略已合并：同一Context内已发送历史只追加；普通工具可能产生的图片若使下一请求超过64，则先阻断该工具（尚未admit play），保存checkpoint，再交付带当前图像/authority/笔记的新Context。inspect一次最多16图必须预留，不能只在达到64后才处理。已接纳Action receipt先结算，不重放；恢复已有溢出上下文必须fail closed，不能滚动删图掩盖。

## 已完成的修复后基线（旧滚动图片策略）

Run `run-artifacts/cd82-cache-20261008T093245Z`，opencode-go/deepseek-flash，max，400 Action budget，缓存Game offline；没有更改提示词或checkpoint token阈值。

- WIN，106 Action，6/6，无RESET；audit exit0/ok=true/findings=[]。
- 09:32:47.004Z→10:33:27.504Z，60分40.5秒。
- 130 provider_request responses；完整输入30364459=input12945323+cacheRead17419136+cacheWrite0；weighted hit57.3668577464%。output263803，其中reasoning244424。
- imageCount最大64，76/130请求达到64。未触发token checkpoint（0 request/commit/phase）。知识使用4working/1guide。
- per-request耗时median12.6745s、p9061.3899s、p95108.41545s、max266.429s。
- 不将比上一局134动作/50.74%的变化归因于图片策略修复：本局并未改图片策略，且模型运行有随机性。历史alias版本未冻结。

## 离线定位

见cache-prefix-diagnostic-2026-10-08.md。172旧请求在public Models serialization下重建，unbounded旧消息修改0、bound64修改91；request72前缀1241076→1433字节，实际cache99.79%→0.88%。无新增图片时postcap前缀稳定且10次请求cache99.77–99.85%。这支持滚动图替换是明确问题，不证明所有服务端miss的根因。

## 下一轮验收与测量

先离线验证：实际HTTP序列化历史在每段内只追加；工具增图预留；旧上下文checkpoint不增图；新Context包括最新视觉和必要笔记；不重复Action；拒绝/保存失败/恢复/cancel/budget分类。

再运行相同Game/provider/model/thinking/budget的真实对照，记录每段checkpoint次数、provider输入/缓存/图片数量、耗时、笔记、WIN和audit。新段冷启动cache miss是正常成本，不能只比较末次cache或要求99.82%。主线程汇总完整input口径；provider请求和外层operation不混计。记录本次策略是新变量，并保留原始无secret指标。

离线组合验收：锁定Node22.23.1/npm10.9.8/Python3.12.9下npm run check/build/git diff --check通过；TS194、Python29、contract各4、integration76，coverage门槛未降低。包含actual public-provider mock wire prefix、48+16/49+16 inspect、62+1/63+1 play、restored65零provider调用、effect_pending先结算且不重发、非DeepSeek不施加64上限。

## 真实图片checkpoint局：机制成功，缓存收益未成立

Run `run-artifacts/cd82-image-checkpoint-20261009T072046Z`，模型/game/thinking/budget与基线相同。07:20:48.583Z→08:28:16.535Z，共67分27.952秒；WIN、104 Action、6/6、exit0、锁定Node22 audit exit0/ok=true。没有工具失败。

| 指标 | 滚动窗口基线 | 图片checkpoint局 |
| --- | ---: | ---: |
| Action | 106 | 104 |
| provider responses | 130 | 145 |
| 完整输入 | 30364459 | 16663148 |
| 未缓存input | 12945323 | 13141356 |
| cacheRead | 17419136 | 3521792 |
| output | 263803 | 315471 |
| reasoning（已包含于output） | 244424 | 289983 |
| 加权hit | 57.37% | 21.14% |
| 总时长 | 60分40.5秒 | 67分27.952秒 |
| committed checkpoint | 0 | 2 |

145个provider_request响应与5个外层operation响应分开统计。图片max64、median33、mean32.38；旧Context checkpoint调用保留64张历史图而不添加新图（“不增图”不是“没有历史图”）。

checkpoint在Turn47和91各完成一次request→保存commit→fresh→ack，分别44.256s和27.617s；没有token threshold checkpoint。知识使用5次write_working、2次save_compact_checkpoint；2 guide版本、7 working版本。首次真正的图片容量checkpoint端到端与恢复进度验证通过。

分段：initial64请求/full7070623/hit14.34%；Turn47后67请求/full9112994/hit26.86%；Turn91后14请求/full479531/hit12.44%。各段去除首请求后的hit仍为14.35%/26.86%/12.09%，所以低hit不能仅用新段第一请求冷启动解释。首段未发生任何图片滚动替换却已低hit，支持还有其他原因。

provider耗时median15.451s、p9057.509s、p9590.900s、max164.631s；sum65分40.872秒。第二fresh后首请求耗时164.631s，产生18993 reasoning tokens。笔记重建/模型推理成本可能重要，尚未建立因果。

结论：修复了已知prefix改写并真实验证两次容量checkpoint，但本局缓存率/未缓存输入/输出/时长未改善；完整输入减少约45%并不等于实际费用降低。不可将新段首请求cache或动作数当优化成功。单次跨日期且历史alias未冻结，不能断言checkpoint单独导致所有退化。保留该机制作为容量正确性保护，不再以“已经提高缓存命中”描述。下一步优先离线分段wire重建核实本局段内prefix稳定与usage，必要时提出受控服务端验证；不盲目重复付费跑Game，不伪造provider/client身份，不改private payload。

长任务token阈值checkpoint仍未真实触发验证；本实验只验证图片容量路径。
