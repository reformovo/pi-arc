# OpenCode Go 缓存行为：官方支持反馈草稿

## 渠道与发送状态

官方Zen文档Contact us链接实际指向mailto:help@anoma.ly；Go文档footer同时提供https://github.com/anomalyco/opencode/issues/new和https://opencode.ai/discord。来源https://opencode.ai/docs/zen/与https://opencode.ai/docs/go/（本轮解析官方HTMLhref确认）。Zen邮件是OpenCode官方联系入口，不声称专用Go工单系统。

建议优先邮件，避免公开账户/使用记录。以下内容仅公开合成实验，不含仓库代码、Game记录、密钥、账号、session/header值、本机路径、请求正文或个人信息。**尚未发送**；没有邮件工具/账号渠道配置，也没有自动创建公开issue。

## 可发送正文（English）

Subject: Additional controlled evidence for issue #51993 — OpenCode Go DeepSeek image-prefix cache regression

Hello OpenCode team,

This appears closely related to https://github.com/anomalyco/opencode/issues/51993. We would like to add controlled image-position measurements and a direct DeepSeek comparison rather than file a duplicate report.

We are investigating multimodal prefix-cache behavior through the OpenCode Go OpenAI-compatible Chat Completions endpoint, using the wire model ID `deepseek-flash`.

We use the public Pi API/provider adapter, with a stable `x-opencode-session` within each experiment and a Pi User-Agent. Requests use thinking enabled, reasoning effort max, a 256-token output limit and zero retries. All inputs are synthetic: a fixed long text and deterministic 1024×1024 PNGs. No repository code, customer data, or application transcripts are involved.

We compared two otherwise identical histories. The first user content is either image A followed by the fixed text, or the same fixed text followed by image A. Each baseline is repeated, then extended with text, image A, or image B. Every repeated variant is sent again. Extensions start from the exact same fixed baseline history, not the model's changing responses. A read-only payload observer confirms that the old serialized message prefix and request options remain unchanged.

Reported full input is approximately 29.5k–30.2k tokens. Cache reads are:

| Variant | Image before long text | Long text before image |
| --- | --- | --- |
| Identical baseline repeat | 29440 / 29499 | 29440 / 29498 |
| Append text | 29440 / 29512 | 29440 / 29511 |
| Append the same image | 0 / 30164 | 28672 / 30163 |
| Repeat same-image request | 30080 / 30164 | 30080 / 30163 |
| Append a different image | 0 / 30164 | 28800 / 30163 |
| Repeat new-image request | 30080 / 30164 | 30080 / 30163 |

The figures are cache-read tokens / total input tokens, not percentages averaged across requests. Both eight-request groups completed successfully. Sessions were distinct between groups; within each group the session identity remained fixed. We understand cross-session cache sharing and best-effort cache construction are possible, and are not treating a new session as guaranteed cold.

This suggests that adding images affects reuse of the prefix from the first image onward, even when the earlier image and HTTP message prefix have not changed. We are not claiming a particular backend implementation defect without your clarification.

Could you please confirm:

1. Which backend/model revision currently serves `deepseek-flash` on Go, and whether it is equivalent to the listed `deepseek-v4.1-flash` model?
2. Is cache invalidation from the first image onward an expected consequence of multimodal preprocessing or token/position representation when another image is appended?
3. Is there an officially recommended request format to preserve image/text prefix reuse in a long multimodal tool conversation, without reordering or dropping historical observations?
4. Is the Responses API officially supported for this model through Go, including image-bearing tool outputs, and does it use a different preprocessing/cache path from Chat Completions?
5. Are stable file references or image identifiers supported on Go, and if so, do they affect KV-cache reuse rather than only upload cost?

We checked DeepSeek's Context Caching, Vision, Thinking Mode and Responses documentation. We understand caching is automatic and best-effort, and that historical reasoning is included only for requests carrying tools. Our position experiment uses ordinary text, not historical reasoning, and the reported input token count verifies the long input actually enters the model context.

We subsequently ran the same synthetic probe against the official DeepSeek Chat Completions endpoint using its public `deepseek-flash` model. Both image-before-text and text-before-image variants reused 29,440 of approximately 30,164 input tokens (97.60%) when either the same or a new image was appended; identical repeats reused about 99.30%. All 16 direct requests succeeded. Thus the position-dependent invalidation observed through Go was not reproduced on the direct service. We recognize these are separate runs/accounts and the backend revision may differ; could you help identify the relevant service-path difference?

We can supply a standalone synthetic reproducer or private request IDs through your preferred secure channel. We have not included credentials, session values, or raw payloads in this message.

Thank you.

## 可复现范围

repo内部已有scripts/probe-vision-cache.mjs long-before/long-after，调用者自己的Go密钥只从本机环境提供；不把仓库脚本自动附给外部，也不公开其依赖/内部项目名。若官方要求standalone复现，再制作不依赖私有代码的单文件公开合成示例。

## 下一步所需

邮件发送需用户从自己邮箱发送上文，或提供明确可用的发送渠道。若改公开GitHubissue，须确认repo、公开正文与发布身份；不能仅因footer链接存在就发布。DeepSeek直连对照随后已获用户授权并完成16次合成请求，未复现Go位置失效；结果已补入英文正文，反馈仍未发送。
