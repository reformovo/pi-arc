# 12 Action 实际序列化前缀诊断

## 结果

Run `run-artifacts/cd82-prefix12-20261009T092611Z`；cd82-fb555c5d/opencode-go/deepseek-flash/max/12 Action budget，cached Game offline。09:26:12.463Z→09:56:56.750Z，30分44.287秒。严格Turn12终止action_budget_exhausted/non_success/exit10；锁定Node22 audit exit10但ok=true，无findings。这是预期诊断终止，不是通关测试失败。

25个provider_request response与25个request_prefix serialization observation通过同一requestId关联，均在segment1，无unsupported/diagnosticFailed。前两次stopReason=error、usage全0，不计有效cache比例；后续23次有usage。transport HTTP replay不一定触发新的serialization observation，不能把此数量当实际HTTP发送次数。

完整输入2567137=uncached1799777+cacheRead767360+cacheWrite0；aggregate hit29.89%。output186541含reasoning174341。provider duration累计1834673ms，接近总时间；12 Action预算不等于小时间或小token预算。图片最高37，未触发任何容量checkpoint/滚动图替换。

## 已排除的客户端变化

所有24次可比较请求appendOnly/systemStable/toolsStable/optionsStable=true，firstChangedIndex/role均null；prefix匹配message数量等于上一请求全部message数。actualImageCount与usage hook imageCount完全对应。metadata来自真实公开before_payload hook，不再是固定system/currenttools的离线重建。仍只覆盖allowlisted options，不证明未知provider扩展/服务端表示稳定；HMAC key不落盘、不保存正文、图片、auth/header或payload。

## 最明显的关联

按相邻响应imageCount是否变化分组（排除usage0的两个失败响应）：

| 组 | 有usage的响应 | 完整输入 | cacheRead | 加权hit |
| --- | ---: | ---: | ---: | ---: |
| imageCount不变 | 9 | 803524 | 737664 | 91.80% |
| imageCount增加 | 14 | 1763613 | 29696 | 1.68% |

例如request8图片9→10，旧prefix保持append-only，hit4.31%；request9维持10图，hit82.79%。request12图片11→12，hit2.15%；request13维持12图，hit93.95%。request24图片35→36，hit0.965%；request25又增加至37，hit0.958%。不能将逐request百分比简单平均，使用fullInput权重。

第一条有usage的request3维持1图hit97.39%，可能已经有共享prefix cache；前两条error/零usage不能作为cold-cache基准。新增图片组命中通常只剩约2048–2304共享tokens。这支持“新增视觉输入触发缓存失配”作为下一步定位对象，不证明具体服务端vision处理/路由/TTL机制。

## 结论与下一步

旧滚动prefix问题已修，但真实稳定prefix下仍有新增图片相关cache miss。此阶段不继续盲目修改payload、删thinking、伪装Codex身份或整局付费复跑。

建议单独授权最小受控provider实验：同一公开Models/session/header、固定system/tools/options和固定历史，分别追加相同图/新图/纯文字，明确request顺序和重复次数，记录同一serialization metadata及真实usage。最多数个请求，限制output，禁止Game Action；若稳定prefix+同图也失配，再向官方提供无敏感metadata请求cache诊断。不要未经授权运行或把历史Game记录中的密钥/正文发送给第三方。

主线程已直接核对runtime安全字段、两条零usage error、分组加权hit、terminal和audit。未导出session内容，未改运行策略。此报告不声明缓存问题已修复。
