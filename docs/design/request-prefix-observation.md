# 实际请求前缀的安全观测

用户在分段离线诊断后授权继续定位。本方案只增加诊断观测，不改变provider payload、模型/提示词/tool协议/checkpoint阈值，也不声称能够观察服务端tokenization/routing/cache状态。

## 已有证据

- 旧滚动64图片策略91次改写历史prefix；替换为容量checkpoint后真实运行3个Context段重建均append-only。
- 新局6/6 WIN/104 Action/两次checkpoint/audit通过，但cache21.14%，低于旧基线57.37%。
- 分段重建使用固定diagnostic system和当前tools，不是原始完整request，需更接近实际serialization的证据。

## 观测边界

仅使用公开AgentHarness before_payload hook，返回undefined，不改写请求。记录与provider_request关联的metadata，诊断不属于Environment authority。它观察每次序列化，而不是每一次底层HTTP retry；同一序列化body可能由transport多次发送，不能从hook次数推断HTTP请求次数。Options摘要只覆盖明确安全的allowlist，不能证明所有provider扩展字段都没变化。

允许：支持的协议形状、message数量、字节计数、上一请求prefix匹配数量/长度、首次变更index/role、system/tools/options的摘要、image/thinking计数、segment/request identity和时间。

禁止：payload或message正文、tool arguments、图片/base64、auth/header值、环境变量、错误原文。不能对未知payload整体落盘；未知协议只报告unsupported。只允许明确无凭据字段参与config摘要，诊断内存只保留hash/长度，不能存上次原始payload。摘要不能称为精确token长度。

## 验收与实验顺序

公开Models + mock HTTP验证：实际发送消息append/reorder/修改能对应metadata；harness重新序列化的重试可区分，transport重用body的重试用mock验证但不冒充hook事件；root切换明确重置segment；未知payload fail-safe，不改请求、不泄漏正文/凭据；无需真实网络。after_response usage和before_payload metadata用同一request identity关联，不能只靠时间近似。

实现已合并且通过离线组合验收：主线程锁定Node22.23.1/npm10.9.8/Python3.12.9运行npm run check/build/git diff --check全部通过（TS200、Python29、双端contract各4、integration76）。六个专项用例包括公开harness+OpenCode serializer与mock HTTP body对应、transform后观测、append/修改/重排、Responses/未知格式、segment reset、privacy。mock503 transport复用body已验证：2次serialization observation对应3次fetch，明确不混计。

摘要采用每次attach独立HMAC key（不落盘），不导出逐message hash；仅持有最多8192条hash/字节数/role，unknown/超限格式只报告unsupported，原始body不缓存。原始异常不持久化。Runtime每次真正完成root navigation才重置诊断segment；与provider_request共享requestId。

下一步决定最小真实缓存验证范围。本轮不自动运行整个Game或重复付费请求。即使metadata证明prefix稳定，也只能排除已观测的客户端变更；还需要服务端usage/cache诊断解释miss，不能伪造客户端身份或盲目加private request字段。
