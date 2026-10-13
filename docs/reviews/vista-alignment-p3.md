# P3：History 最小修复与未决差异

状态：本文件保留P3第一/二批记录。后续用户已批准接入recovery Attempt summary，实际第三批变更和验证见 [恢复摘要接入](vista-recovery-attempt-summary.md)。history动作参数仍未接入；以下“未实施/暂停”表述描述当时状态，不是第三批后的现状。非 accepted 规范。

## 已实施的最小修复

只修改 `src/application/model-tools.ts` 的 history 投影和对应 unit tests，保持工具输入、结果顶层 shape、字段上限、公开 schema、提示词和其他 runtime 不变：

1. `history.events` 无 `start_turn`/`end_turn` 时返回匹配记录的最新 `limit` 条，和固定 VISTA controller 行为一致；显式范围仍从范围起点向后分页。
2. `history.attempts` 先对完整查询结果聚合 Attempt，再按 `limit` 返回最新 Attempt 摘要；不再先按 Turn 截断后聚合，避免一个 Attempt 被拆断或早期 Turn 霸占 limit。
3. 保留 `actualStartTurn`、`actualEndTurn`、`truncated`；没有添加字段、CLI flag、SDK 参数或 schema major revision。

这两项属于输入已被 accepted 规范固定、但实现取样/计数不一致的内部投影修正；没有改变 history 的名称、输入参数或结果顶层结构。没有把历史 native Action 直接暴露给模型。

## 明确不实施的项目

### events 动作参数

VISTA public event 包含动作及结果；pi-arc 当前 events 只包含 actionId、Observation、digest、Level/Attempt 标签。直接把 `action.intent` 的 `action` 放进结果并不安全：

- intent 不是单独完成证据；history 只应投影已提交 Turn 的完整 intent/receipt/commit join；
- archive 的权威 action 仍为 native64，模型可见 ACTION6 必须投影为 visual1024 canonical bin center；
- RESET retry_state 和密钥/内部字段不能泄露；
- 增加 `action` 字段是模型可见结果变化，虽未必需要 schema major revision，仍应先有规范/对齐决定和专门 contract fixture。

因此本轮保留差异，未通过宿主层自动补字段。下步若继续，先设计一个只读 projection helper + fixtures，核对和 `runtime-knowledge.modelFacingAction` 相同的 proof join 与 coordinate rule，再决定是否改公开结果。

### recovery history 的 128 条 seed

当前 recovery 仍是当前 Level 最后 128 个 committed Turn，早期 Attempt 可能被完全丢出恢复正文且无 truncation 标志。archive/history 工具仍可读取已提交证据，故不是证据丢失，但与 VISTA per-Attempt summary 不等价。

保守候选顺序：

1. 不改 prompt/tool schema，先在 recovery 内部 fixture 比较一份 bounded Attempt summary 是否能表达同等或更少信息；
2. 若需要模型可见变化，先提出精确文本/字段 diff 和 accepted 规范影响；
3. 不把完整 history 无限塞入恢复消息，不为了 VISTA 形态牺牲上下文和成本边界。

### notes provenance

当前内部 KnowledgeStore 保存 anchor/version/content digest，恢复正文原样传递 GUIDE/WORKING。VISTA 的 `saved_at` 包装是可见形态差异，但 FT09 没有笔记丢失或错误版本证据；本轮不添加 provenance 字段，不修改 prompt。

## 离线验证

新增/调整 history characterization tests 覆盖：最新默认 events、显式范围分页、聚合后 Attempt limit、跨 Level/Attempt、truncated 和空范围。既有 recovery tests 保留 128 条边界、RESET、Level、checkpoint、坐标投影和 proof join。

定向测试：`model-tools.test.ts` 与 `runtime-knowledge-boundary.test.ts` 共 37 tests 通过；`tsc --noEmit` 通过。随后完整门禁：

- `npm run check` 通过：TS298、Python33、contract 双端各4、integration85；
- TypeScript coverage statements90.64%、branches86.39%、functions95.46%、lines93.99%；Python lines93.98%、branches90.00%；
- `npm run build` 通过；
- `npm run check:spec` 通过（86 Markdown files）；
- `git diff --check` 通过。

P2 初版 fixture 曾因大量 durable 写入超过5秒超时；已缩小为必要129 commit边界并设测试局部20秒上限，完整门禁通过，没有改全局 timeout 或生产 budget。

## P3 第二批离线候选（尚未接入生产）

新增 `tests/support/vista-alignment-candidates.ts` 与对应 unit fixture，仅用于验证候选形状，不是 production projection、公开 tool result 或 VISTA 执行。`candidateHistoryAction` 要求输入已经完成 committed evidence proof join，并只允许：

- RESET / ACTION1–5、7 输出最小 `{name,data:{}}`；不携带 retry_state、internal 或其他作者字段；
- ACTION6 只接受 visual1024 的整数 bin-center（`x/y % 16 = 8`）及 `canonical_replay_equivalent` 标签；不会接受 native64、原始未标记坐标或不完整对象；
- 不提供任何 Game 规则、palette、解法或 transcript 信息。

`candidateAttemptSummary` 要求完整、连续、指定 Level 的 committed 序列（包含 Level entry Turn），验证 GAME_OVER→RESET→Attempt+1 后再聚合 Attempt；RESET 不计入 game_actions，summary 只包含 level/start/outcome/action count/end turn，并保留 `total_attempts/truncated`。它拒绝缺失 entry、Turn gap、混合 Level、没有 GAME_OVER 的 RESET、截断 seed 和非法 limit，避免从最近128条记录臆造历史结论。

这两个 helper 仍未接入 `history` 或 `runtime-knowledge`，没有改变 prompt/schema/公开输出；它们证明的是最小安全候选和失败闭合规则，不证明该候选应成为产品契约。若继续，下一步应先人工审阅字段名、恢复消息成本和 accepted §10.4/§10.5 影响，再决定是否实现 production projection。

定向验证：P3 candidate + model-tools + runtime boundary 共 41 tests 通过，`tsc --noEmit` 通过；随后需再跑完整 gate。

## 当前结论与暂停点

可以谨慎声称：history 的两项非等价取样行为已在不改变公开 shape 的前提下修复，并有离线回归。不能声称恢复 history、动作参数可见性、笔记 provenance 已与 VISTA 等价，也不能声称整体逐行为对齐。

下一步需要用户单独审阅：是否授权 P3 第二批（动作参数的安全投影设计和 recovery Attempt summary fixture）。本轮未调用 provider、下载 Game、修改 VISTA/.env/旧 artifacts、提交或推送。
