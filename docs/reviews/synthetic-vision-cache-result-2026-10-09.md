# 合成视觉缓存受控实验结果

## 执行与边界

用户授权少量真实请求。Node22.23.1执行scripts/probe-vision-cache.mjs --live，产物run-artifacts/synthetic-vision-cache-20261009T101606Z。固定opencode-go/deepseek-flash/max/session/system/history/options；8请求全部成功，零retry，每次maxTokens256；仅合成文字和2x2红/蓝PNG，无Game/仓库源码/历史transcript上传。

全部oldPrefixEqual/configStable=true，4个repeatEqual=true，相同重复payloadHmac完全相等。HMAC key每次run随机、不落盘，报告不含正文/图片/auth/header/模型输出/异常原文。

| 请求 | fullInput | uncached | cacheRead | hit | duration ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| base | 7430 | 7430 | 0 | 0% | 2593 |
| base repeat | 7430 | 6 | 7424 | 99.92% | 2971 |
| text extension | 7443 | 19 | 7424 | 99.74% | 1466 |
| text repeat | 7443 | 19 | 7424 | 99.74% | 1916 |
| same image extension | 7627 | 459 | 7168 | 93.98% | 1518 |
| same image repeat | 7627 | 75 | 7552 | 99.02% | 1640 |
| new image extension | 7627 | 459 | 7168 | 93.98% | 1499 |
| new image repeat | 7627 | 75 | 7552 | 99.02% | 1626 |

累计output176，小于2048请求上限。单次耗时1.5–3秒量级。本次input计费/图像估算只用reportedusage，不用bytes/4当token真实长度。

## 对前次诊断的修正

12Action真实Game中新增图片组hit1.68%、同图片数91.80%，但此合成控制显示追加相同图和不同图都保留93.98%旧cache，重复99.02%。因此**不能笼统认定OpenCode不缓存新增视觉请求**。同图/新图在此样本无区别；没有支持把private cachekey、client identity或图像内容改写作为修复。

本次变化局限：短历史约7.4k输入、2x2图、user-role视觉、synthetic assistant OK（无历史thinking/toolcall）；真实Game是1024图、工具返回与provider扩展消息、几十万历史tokens、长thinking、多个工具schema、不同时间的backendalias。实验固定max256/temperature0/cacheRetentionshort/retry0也与游戏默认策略不同。不能从小合成成功外推真实Game配置完全健康，不能改变实验后宣称99%Game hit已达成。

## 后续建议

停止整局复跑；若继续，逐项加入更接近Game的合成变量：1024图、toolResult图像布局、固定synthetic toolcall/reasoning、较长固定历史。每次只增加一个变量、请求数/输出明确限额、保留相同metadata，确认哪个条件首次破坏server cache。真实backend请求需要再次确认范围；不发送旧Game/transcript/私有代码，不伪装Codex身份、不改privatepayload。

## 工程验证

合并probe和check:spec collector后主线程npm run check/build/git diff --check通过（锁定Node22.23.1/npm10.9.8/Python3.12.9；TS208/Python29/双端contract各4/integration76）。spec范围修复只排除root runtime/cache/output，不改归档GUIDE且仍检查维护文档。
