# VISTA 对齐后的最小定向真实验证计划

状态：待用户授权，尚未执行。不是WP-10、整局评测或笔记prompt实验。不添加正式CLI flag/schema，不改TASK/system，不隐式重试/下载。候选身份见vista-pre-live-source-snapshot.md（docs/reviews），未提交状态须明确处理。

## 要回答的问题

在正式controller确认GAME_OVER→RESET后，当前恢复构造是否能向官方模型交付：当前Level的Attempt摘要、最后结果、原文续局笔记和当前Visual；模型若调用history，能否读到安全的visual1024动作并使用它继续。

不回答整体通关率/更优动作数/笔记语义已解决/VISTA成绩等同。既有离线实收消息闭环已通过，不把重复试验当收益实验。

## 推荐执行范围（只用已有diagnostic surface）

- 复用`scripts/validate-reset-recovery.mjs`及其已有`--live --confirm-real-model`确认机制，不新建公开SDK tool-driving入口。
- 来源：既有FT09 179个已完成动作。先离线readVerifiedSource完成intent/receipt/commit及source digest核对；正式取得授权后在新sidecar使用同verifiedcache/seed42重放，逐Observation/Frame比较。无需新Game下载，cache不存在或digest不符立即停止。
- setup为driver-replay，不是模型成绩，不复制旧session、旧GUIDE解法或VISTA资产。GAME_OVER后正式RESET携带现有solution-free continuation；使用当前RuntimeKnowledgeBridge与当前Visual，不注入新的笔记模板或强迫history动作指令。
- 官方deepseek/deepseek-flash/max；只接受官方endpoint，OpenCode Go暂停。用户在共享文件之外准备OPENAI_BASE_URL/OPENAI_API_KEY，ARC_API_KEY可选；代理不读取、修改、回显.env或凭据。若凭据未准备则由用户处理，不代读文件。
- 2个provider请求，每个max output4096，总上限8192；retry0，请求timeout120000ms；现有driver总timeout720000ms包括setup/运行。使用既有`--max-requests=2 --max-output-tokens=4096 --call-timeout-ms=120000`，不发明新flags。
- driver已有postRESET Action硬上限12、总工具尝试16、每request最多1个play admission、诊断image cap64。此次2请求意味着模型最多新执行2个Action；不是把12误写成新1-action硬cap。预算包含setup179+RESET1，setup与live计数单独报告。
- 模型可能全部输出reasoning或只分析、不调用history；记录inconclusive/未覆盖history，不增加请求、输出或重跑预算，不以截断零Action证明策略错误。

## 运行前gate

1. 用户明确授权官方请求、加载已验证Game并重放179 setup动作、RESET和最多2个模型新Action、费用范围；不包含下载授权。
2. 冻结源码/构建身份，Node/npm/uv/Python/锁依赖符合指定基线；记录实际prompt/tool digest、VISTA V0对照版本和当前模型/后端revision（无法取得写unknown）。
3. 离线先复查source proof/sourceDigest/Game digest；单独新artifact root，不覆盖旧archive；不误用旧Run attach。
4. 真实命令参数/artifact路径/预算先展示给用户；不在计划中填写或展示secret。

## 通过/未覆盖/停止的判断

- setup或source proof不匹配：停止，不发provider。
- RESET/authority未知或receipt不完整：按controller规则fail-closed，不重发Action或猜状态。
- 能生成并实际交付摘要/Visual/notes：交付契约通过（并保留只读版本/hash证据）。
- 模型调用history：保存安全结果摘要；ACTION6标签和映射可核对。
- 模型play坐标可核对且没有doublemapping：该样本坐标使用通过；不是保证解法正确或完成Level。
- 未调用history或play、length/truncation或预算结束：相关模型使用项inconclusive，报告不掩盖；不将setup结果混作模型输出。

## 报告与provenance

只保存必要安全指标与authority evidence，不记认证头/secret或完整provider payload；记录实际模型request次数/usage/output/reasoning/cache、duration、工具调用、Action/坐标映射/观察、终止分类和audit。backend revision不能可靠冻结则披露，不与VISTA比较成绩。

独立validation record在artifact之外绑定source tree/build/prompt/tool/Game/source digest与结果；不改现有manifest或为2026-10-10运行补造源码归属。旧源码/notes/archive不改，单次结果只关闭指定契约样本缺口。用户未批准前不启动任何live动作，也不提交/推送。
