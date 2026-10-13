# P3 第三批：恢复 Attempt summary 接入

状态：用户授权后的生产恢复投影改动，非规范修订；不修改公开history工具、schema、TASK/system、工具description，不调用真实provider，不开始WP-10。

## 精确模型可见差异

`Environment record.current_level_history` 原来是当前Level最后128个已提交Turn的数组，包含action/Observation/digest。现在为当前Level的Attempt摘要对象：

```json
{
  "view": "attempts",
  "source": "environment action results",
  "level": 5,
  "level_start_turn": 50,
  "progress": { "completed": 4, "total": 6 },
  "attempts": [
    { "attempt": 1, "start": "level_entry", "start_turn": 50, "outcome": "GAME_OVER", "game_actions": 129, "end_turn": 179 },
    { "attempt": 2, "start": "reset", "start_turn": 180, "outcome": "NOT_FINISHED", "game_actions": 0, "end_turn": 180 }
  ],
  "total_attempts": 2,
  "truncated": false
}
```

上例已经由构建后的实际RuntimeKnowledgeBridge只读投影FT09 Turn180历史ledger核对，得到的两个Attempt、状态和计数逐项一致；这不是重跑Game，也没有调用模型。summary从完整Level范围聚合，不从最后128条seed反推。保留最新128个Attempt，total_attempts和truncated明确披露Attempt摘要截断；当前Level细粒度动作不再复制进恢复正文。

未改变Environment/notes分栏、task objective和GUIDE/WORKING正文；`last_action_result` 继续提供最后已提交动作及visual1024投影。既有recovery-only坐标说明只删去对current_level_history中动作的引用，因为摘要不再含坐标。这是必要的恢复表达同步，不是新增笔记策略，也没有改TASK/system提示资产。

## Evidence 与生命周期规则

- 每个用于计数的Action和Level-entry Action仍经现有intent/receipt/commit join校验；pending intent不能成为动作数或结果。
- Level entry Turn不计入新Level的game_actions；它的Action属于上一Level，但其receipt proof仍须有效。
- Level首Attempt必须为1；非初始Level要有前一Level的前序Turn作为entry锚点，当前Level序列必须连续。
- summary outcome取权威Observation.state，不是模型笔记推导的成功/失败。
- GAME_OVER后RESET开始Attempt+1，旧摘要end_turn保持GAME_OVER的Turn；RESET为新Attempt的start_turn。
- RESET不计入summary.game_actions，与VISTA摘要规则一致；它仍是正式Action，继续消耗Run budget，控制器规则不变。
- Attempt无RESET而改变、RESET从非GAME_OVER发生、Turn gap、缺entry/proof/Observation均拒绝恢复；不补猜动作或状态。
- summary不含native坐标、retry_state、完整Action、pixelgrid、笔记或任何求解规则；只含结果状态和计数。

## 规范与对齐边界

accepted §10.4 的公开history工具输入/结果保持；本变更只替换runtime内部恢复投影。§12.4/12.6/12.7的证据与boundary语义不变。保留VISTA per-Attempt start/outcome/game_actions/end结构，额外提供Level和Attempt截断信息；底层仍是Pi session及versioned receipt authority，不声称与Codex transport逐结构/逐行为相同。

必要取舍：相比旧数组，恢复正文不再给所有最近动作参数；早期Attempt失败的上下文得到保留，细节仍需history/inspect工具查询。但history.events尚无动作参数，仍是未解决的对齐缺口，不能说整体信息完全等价。本轮未擅自扩展公开工具字段。

原来的tests/support离线候选没有导入生产；生产直接复用RuntimeKnowledgeBridge已有proof join。候选与生产的计数/状态规则有对应回归，但不将synthetic fixture当作真实Game/模型质量证明。

## 测试与结果

已更新实际bridge测试：初始/Level-entry、RESET两个Attempt、checkpoint同anchor不变、超过128动作保留旧Attempt、130个Attempt只返回128并标truncated、缺entry/中间Turn/早期receipt/错误Attempt拒绝。既有坐标parser、notes原文重交付、pending/partial-write等回归继续保留。

定向三文件39用例及tsc通过；初版断言仍按旧数组计数导致两项失败，已改为正确的Level-entry/RESET计数断言，并让测试fixture显式提交GAME_OVER状态。

Node22.23.1/npm10.9.8/uv0.8.12/Python3.12.9下，完整 `npm run check`、`npm run build`、`git diff --check` 通过：TS307、Python33、contract双端各4、integration85（跨gate有重叠）；TS statements90.55%/branches86.51%/functions95.47%/lines93.91%；Python lines93.98%/branches90.00%，原门槛未降低。

额外用compiled runtime只读读取FT09 Turn180的历史ledger、v161笔记和retry_state，确认summary得到Attempt1 Turn50→179/GAME_OVER/129 actions，Attempt2 Turn180/NOT_FINISHED/0 actions；notes原文不变；domain.jsonl前后bytes一致。知识输入使用只读snapshot adapter，不创建KnowledgeStore写入或Game实例，不能冒充正常resume、端到端provider效果或独立完整audit。

独立reviewer因服务overload失败，没有审阅报告，不视为approved。未调用provider、下载Game、读取/修改.env、修改VISTA或历史artifact、提交/推送；仍不宣称语义收益或整体VISTA对齐。
