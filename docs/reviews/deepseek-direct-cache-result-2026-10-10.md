# DeepSeek 官方直连：相同位置实验对照

## 结果

用户提供官方DeepSeek配置后，使用同一probe脚本在官方api.deepseek.com执行long-before/long-after。provider=deepseek、公开baseline=deepseek-flash、wiremodel=deepseek-flash，max/maxOutput256/retry0，同一synthetic139239字符text/1024PNG/固定历史，16请求全部成功。产物run-artifacts/deepseek-long-position-20261010T051332Z。

官方直连**没有复现**Go此前首图后缓存失效：

| 请求 | Go:image→text | 官方:image→text | Go:text→image | 官方:text→image |
| --- | ---: | ---: | ---: | ---: |
| base repeat | 99.80% | 99.37% | 99.80% | 99.37% |
| append text | 99.76% | 99.32% | 99.76% | 99.33% |
| append same image | 0% | 97.60% | 95.06% | 97.60% |
| repeat same image | 99.72% | 99.30% | 99.72% | 99.30% |
| append new image | 0% | 97.60% | 95.48% | 97.60% |
| repeat new image | 99.72% | 99.30% | 99.72% | 99.30% |

官方每组首basecoldcache0，所有oldPrefixEqual/configStable/repeatEqual为true；fullinput29498–30164，达到20000门槛。包含coldbase的全组hit86.61%不是warmrequest水平，不能简单与扩展比例混用。output官方16请求共462，未超4096；无retry/Game/privatecode/transcript。

## 归因边界

两条渠道公开modelmetadata输入图像、window1000000、maxOutput384000、compat（store/developerrole/max_tokens/reasoning_content/deepseekthinking）相同。thinking map有不使用level的差异，本实验max相同。官方provider不发OpenCode x-opencode-session，Gowrapper发送；这是合法provider差异，不是需要伪装/覆盖的header。

跨渠道时间/账号/实际backendrevision不同，不是完全同时bit-identicalserver对照，因此不能认定Go某个内部bug；但官方正常与Go位置差异相结合，优先调查Go服务路径/后端revision/视觉处理与cache。**不再将此前模式笼统归为DeepSeek官方视觉缓存限制**。

下一步更新对Go的反馈草稿，包含官方direct对照，询问backendrevision与是否存在不同visionprefixcache实现。不再次整局付费跑Game，不上传secret/账号/localpath。用户决定是否发送工单；当前未发送。

## 凭据与工程

配置已统一OPENAI_API_KEY，officialhost选deepseek，Go/custom保留opencode-go；旧OPENCODE_API_KEY不回退，其他providercredential解析未改变。.env明文曾再次被共享编辑通知暴露，用户需要撤销轮换；本轮工具未读取/打印密钥，不声称泄露已消除。真实试验使用Node --env-file加载，不输出key。

主线程合并认证测试冲突后npm run check/build/git diff --check通过：锁定Node22.23.1/npm10.9.8/Python3.12.9，TS231/Python29/contract各4/integration76。没有源码commit。官方直连的实际Game/高图片数量限制仍未测试，此次仅1–2图合成请求。
