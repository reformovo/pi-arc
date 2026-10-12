# DeepSeek / OpenCode 官方契约复核

## 来源（本轮直接抓取，不以搜索摘要替代）

- https://api-docs.deepseek.com/guides/kv_cache
- https://api-docs.deepseek.com/guides/thinking_mode
- https://api-docs.deepseek.com/guides/vision
- https://api-docs.deepseek.com/guides/responses_api
- https://opencode.ai/docs/go/

公开网页内容会更新；本轮未使用credential、没有模型调用，不修改runtime。搜索snippet仍出现旧vision-exp名，而实际抓取vision页已写deepseek-flash/legacyretired，使用实际页面作为当前证据。

## 已明确解释的现象

### 合成reasoning未增加usage

Thinking Mode官方：带顶层tools参数时所有历史reasoning_content应完整传回并进入context；不带tools时reasoning_content即使传回也会被忽略、不拼接context。

此前tool/reasoning合成stage只有synthetictoolcall/result历史，没有顶层tools声明；所以长字段被wire发送但usage不增长是已文档化行为。这个实验不能代表真实Game（实际MODEL_TOOL_DEFINITIONS随请求发送，历史reasoning进入context）；不应据它建议删除Game思考历史。

Thinking模式temperature/presence_penalty/frequency_penalty被忽略。probe固定temperature0不能称为输出确定性控制，不过输入/serialization/usage关联实验仍有效（生成不回填固定base历史）。

### session routing

OpenCode Go明确要求coding-client userAgent、每conversation稳定x-opencode-session，以优化routing/promptcache；Pi currentbuild被列为已验证client。已mock验证当前wrapper发送piUserAgent和sessionheader，因此没证据将miss归为忘记sessionHeader。文档不承诺某个cache命中率，也不要求额外privatecachekey。

### Cache规则

DeepSeek自动启用cache，不需请求flag；必须完整匹配已持久化cache-prefix-unit。当前Sliding Window Attention规则在userinput/modeloutput端点、公共prefix检测和固定token间隔形成独立单元。best effort，构建需数秒，闲置数小时/天清理。

这解释为何重复完整request可高hit、相同HTTP JSONprefix不构成必然serverhit保证，但不单独解释图片位置实验0%vs95%。不能把一般SWA说明当“官方证明某imageposition算法”。

## 仍没有官方直接说明的原因

Vision说明图片按尺寸变为tokens、多图独立计数；未说明“追加图改变首图之后token/KV缓存”或给出imageprefix稳定建议。我们的long-position配对实验支持视觉处理/表示相关缓存前缀不稳定；无法从公开文档分辨DeepSeek模型/预处理和OpenCode代理具体哪层。

Files API官方推荐避免重复上传同图，不承诺改善KVcache，OpenCode Go未在本轮文档确认兼容该API；不能直接换file_id当缓存修复。

Responses API官方支持真实input_image及tooloutput图像、stateless（previous_response_id/conversation/store不支持）；prompt_cache_key/prompt_cache_retention明确不支持、contextcache自动管理。既不是用key打开缓存，也不能靠serverconversation免发历史。DeepSeek官网支持不等于OpenCode Go对该alias支持/行为相同；Go目录当前DeepSeek列chat/completions。

## 版本/限制不能混用

DeepSeek当前Vision页：deepseek-flash，旧vision-exp映射latestFlash；图片最多600张。OpenCode Go当前目录仍列V4.1/V4/vision-exp，pi-arc曾真实收到101>64错误。因此不能拿DeepSeek直连600去删除Go实测64保护，不能用官网alias说明证明Go历史alias版本固定。

## 定位结论

1. 客户端旧prefix改写已被修复与exactserialization验证排除。
2. syntheticreasoning实验无tools导致被忽略的原因由官方文档确认。
3. 当前实际剩余cachemiss具有视觉位置依赖，但官方未公开其内部cache/vision原因；目前只能定位到HTTPserialization之后的服务端表示/cache匹配路径，不能宣称已确认OpenCode或DeepSeek的具体bug。
4. 不追加privatecachekey、不删除Game reasoning、不伪装Codex、不把fileupload优化等同KVcache优化。

下一步建议以公开合成复现向OpenCode Go询问后端模型revision、图片prefix处理以及官方支持Responses路径；若用户另授权DeepSeek直连同模型对照，可区分代理层与模型层。询问/发工单/上传材料是对外行为，未在本轮自动执行。
