# 第 3 轮评审记录：持久性与失败语义

> 状态：已通过（2026-09-21）。本文是评审记录，不是实现契约。

## 本轮完成项

- 将第 2 轮标记为用户确认通过，并把规范推进到 `design-round: 3`。
- 复核 Pi 0.86 AgentHarness 的 intent/effect/settlement、safe/never replay、tool checkpoint/memo、provider partial recovery、open operation attach 和 close/fault 语义。
- 定义 Run durable binding，以及 Action intent → Environment receipt → Turn commit 三段完成 Evidence。
- 为模型请求、safe 工具、`play`、RESET、checkpoint、sidecar、Raw Frame、终止和迟到结果建立故障矩阵。
- 明确 AgentHarness v4 与 ARC controller/sidecar 的保证边界。
- 创建 ADR 0001，记录未确认 Environment Action 的 fail-closed 原则；本轮通过后已标记为 `accepted`。
- 保持 docs-only，没有源码、依赖、工具配置、game 数据或 work package。

## 本轮核心提案

1. 只有 Turn commit 证明 Action 完成；Pi tool settlement、progress checkpoint 或模型 transcript 都不够。
2. 所有 `play`（含 RESET）固定为 `replay: "never"`。无法确认是否执行时立即 Unknown Outcome fail-closed。
3. Recovery 只能在原 Environment 实例仍存活且与最后 Turn commit anchor 一致时继续；v1 不重放 Action 重建 Environment。
4. 只读工具可以 safe replay；GUIDE/WORKING/checkpoint 只有在 stable invocation + anchor 条件下安全重复。
5. RESET 的 retry_state 先 pending，RESET Turn commit 后才成为新 Attempt 的 WORKING；boundary delivery 可重试，RESET 不可重发。
6. checkpoint 的 partial files 无效；完整 marker 前持续阻止 `play`，无法完成时以已知 `checkpoint_failed` 终止。
7. sidecar 必须串行 Action、标识 Environment instance、持久化并按 actionId 查询 receipt；实例丢失后禁止新实例继承 active Run。
8. terminal record 不可改写；迟到结果只能追加 Evidence，不能重开 Run 或把 Unknown Outcome 改成 WIN。
9. AgentHarness 工具执行必须使用 sequential 模式；每个 assistant response 只执行一个 `play`，其后调用等待模型观察后重新发起。

## 故障结论摘要

| 故障类别 | 结论 |
| --- | --- |
| provider 请求中断 | AgentHarness captured policy 内恢复；不执行 partial tool call |
| safe tool 中断 | 同 invocation/参数/anchor replay |
| `play` intent 后结果不明 | 不重发，Unknown Outcome |
| receipt 已完成、Pi 未结算 | 完成/读取 Turn commit，交付 recovery envelope，不重发 Action |
| RESET 后 boundary 丢失 | 重新交付同一 reset envelope，不再次 RESET |
| checkpoint 部分保存 | 不生效，不解锁 Action |
| sidecar 丢失 | 无 pending Action 为 `environment_lost`；有 pending Action 为 Unknown Outcome |
| 已提交 Evidence 损坏 | 停止新 Action 并标记 `evidence_corrupt` |
| terminal 后迟到结果 | 追加 post-termination Evidence，terminal 不变 |

## 设计中发现的关键区分

- Pi 的 `runId`/operation 与 `pi-arc` Run 不是同一领域身份。
- Pi 的 tool checkpoint 是 effect-pending progress；ARC checkpoint 是 Context Boundary 的完整知识快照。
- Environment receipt 证明 adapter 完成了一个 Action；Turn commit 才是 `pi-arc` 对该结果的完成 Evidence。
- “同一实例证明从未接受后首次提交”不是 replay；无法得到这个证明就必须停。
- Environment 已知丢失与 Action Unknown Outcome 不同，必须用不同终止分类。

## 本轮没有作出的决定

- 没有选择 domain ledger/receipt 的物理数据库或文件格式。
- 没有确定 sidecar transport、进程拓扑、health protocol 或 reconnect timeout。
- 没有定义 recovery envelope 和逻辑记录的精确 wire schema。
- 没有确定 CLI exact exit code、artifact 文件名或 SDK TypeScript signatures。
- 没有创建 implementation handoff 或 work package。
- ADR 0001 已随本轮通过标记为 `accepted`。

## 审阅结论

用户于 2026-09-21 确认审阅通过：

1. 接受 Action intent → Environment receipt → Turn commit 三段协议，以及只有 Turn commit 构成完成 Evidence；
2. 接受 `play: never`、Unknown Outcome fail-closed，以及 v1 不重放 Action 重建 Environment；
3. 接受 safe 工具、RESET、checkpoint 和 Context Boundary 的 replay/commit 语义；
4. 接受 sidecar identity/receipt、Environment recovery 条件、archive 损坏和迟到结果规则；
5. 接受 AgentHarness/ARC controller 责任边界，并将 ADR 0001 标记为 accepted；
6. 批准进入第 4 轮，设计 Biome/Ruff/`tsc`/Pyright/Vitest/Pytest 和 CI 质量门禁。
