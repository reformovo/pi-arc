# 分阶段合成视觉缓存验证

用户在小图受控实验后授权按建议推进。短历史/2x2图追加可保持94%命中、重复99%；不能从Game新增图1.68%命中推断所有视觉缓存无效。下一步用单变量分阶段实验定位。

## 限额

large/tool/reasoning各最多8请求，合计最多24，每次输出256（请求output上限总6144），retry0，单请求120秒、每组12分钟。仅公开合成内容，没有Game Action/仓库源码/旧transcript上传。失败停止，不自动扩大/重跑，不保证美元硬上限。各组使用独立session但组内固定，避免跨组预热污染；runtimeGame未改策略。

## 阶段

1. large：固定原小图实验文本与user消息布局，仅图片换为确定性1024RGB PNG；比较原tiny结果。
2. tool：与large同样1024图，换为合法synthetic toolcall/toolResult图像布局，不执行工具。角色变化不可避免需要增加assistant call/工具标识与schema，明确这些是结构变量，不能声称除此以外逐byte相同。
3. reasoning：保持tool stage完全同样消息/图像/schema，唯一新增固定synthetic长reasoning_content（约16k token代理，不是实际token承诺），检验历史thinking是否影响缓存。

每组base/repeat/text-extension/repeat/same-image-extension/repeat/new-image-extension/repeat。extension始终从该组相同固定base出发，不把实际生成内容加入历史。记录真实usage/时延、原始前缀相等性、重复body相等性、配置稳定、图像数；只落盘安全metadata/HMAC，不落盘正文/base64/auth/header/异常原文。

## 验收

离线确认PNG尺寸/有效性、实际公开序列化布局、固定tool identity/思考字段、每组8limit/retry0、privacy和observer不改payload。若tool图像被publicadapter转换而使prefix改变，应记录现象而非隐蔽修正协议。真实请求完成后只报告每组证据，不用跨时间单样本承诺Gamecache已修复。

## 状态

脚本/离线tests实施中；真实24请求尚未开始。
