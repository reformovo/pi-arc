# P4：独立验证 provenance 与发布前收尾

设计证据，不修改 accepted Run manifest/schema，不授权真实请求、Game下载或Git发布。

## 推荐记录方式

未来经单独授权的验证，在artifact之外创建一份独立、不可冒充Run authority的validation record。不改历史manifest，不将它纳入Run audit的权威结果或自动resume输入。不读取凭据；只记录明确安全的标识/摘要，不保存完整请求、环境变量、认证header或notes正文。

运行前固定：
- pi-arc source commit；tracked source diff是否为空；源码树摘要（只覆盖审阅范围的tracked source/schema/build配置，排除.env及所有runtime artifact）；本次未提交源码则标dirty并附审阅diff摘要，不能声称精确commit运行。
- Node/npm/uv/Python版本、lockfile摘要、构建前后source未变化、原prompt/tool description及实际组合system/input-schema摘要。
- VISTA对照V0完整commit和已核验prompt/tools/harness/recovery摘要，intentional divergence清单版本。
- Game ID/treeDigest/seed、provider/model/thinking/actionBudget；credential只记录由用户提供/未检查，不读.env。
- backend revision若provider未公开可靠值则unknown；不把model alias或本地Pi版本当后端冻结证明。

运行后绑定：
- validation记录到runId、artifact manifest摘要、terminal reason/lastTurn、audit结论和ledgerHead。
- 具体检查范围（正常Game/diagnostic setup/faux/offline projection）以及停止、取消、inconclusive事件。
- 恢复后请求数/耗时、错误坐标、重复失败试验（起点无法判定为unknown）、动作/output成本的计算口径。

只在真正运行前/后取得值，不为已有2026-10-10记录补写虚假的源码tree或后端revision。运行早于Git提交不证明源码不同；不能确认时保留unknown。最小记录格式可为单独Markdown/JSON验证说明，尚未建立自动化写入命令；用户确认live验证范围前不创建空的“已验证manifest”。

## 当前离线收尾清单

- history输入/顶层schema不变；events新增action是公开结果内容变化，精确diff已记录，不宣称输出不变。
- TASK/system资产、工具description、CLI/SDK、依赖/生成schema无未经批准diff；恢复说明仅同步摘要不含coords的事实。
- 单一proofjoin与视觉投影供history/recovery使用，不泄露RESET retry_state/内部字段。
- SDK/faux provider实际看到摘要/最后结果/Visual/notes，history实际结果包含动作。
- 长ledger synthetic projection记录机器/口径/规模，避免用一次耗时或token字节估算宣称模型收益。
- 完整指定工具链门禁、范围核对、独立review结果；review服务失败不是批准。
- 用户另行授权前不提交、合入用户main、push或live验证。

## 可声明与仍保留的边界

可以逐项说固定prompt/六个description保留，history取样/计数与安全action投影、recovery Attempt summary经过离线验收。仍保留跨Level history、结果包装、Pi/Codex session机制、两句规范补充、notes provenance/空值等差异。

没有同backendrevision多样本验证，不宣称逐行为一致、成本改善或优于VISTA。source provenance/live token容量checkpoint/真实新摘要效果依旧未验证；既有FT09 WIN和历史raw坐标错误不能充当修复后整局收益证据。
