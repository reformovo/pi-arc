# 第 3 轮持久性与失败语义分析

> 状态：设计证据，不是实现契约。规范性结论只以 [`docs/pi-arc.md`](../pi-arc.md) 第 12 节为准。

## 1. 问题

Pi 0.86 的 stable `AgentHarness` 能把一次 tool invocation 放进 durable intent/effect/settlement 状态机，但任何外部效果都可能发生在 settlement commit 之前。对于 `replay: "never"` 的工具，进程丢失后 Harness 会生成中断结果而不是再次执行；它明确不承诺 exactly-once external effects。

ARC 的 `play` 比普通工具更严格：它可能永久改变一个只存在于 Python Environment 实例中的游戏状态。若仅依赖 Pi session，无法判断 Action 是“尚未发送”“已执行但响应丢失”还是“已执行且 controller 只差落盘”。因此 `pi-arc` 必须建立独立的 domain effect ledger 和 Environment identity。

## 2. 采用的效果模型

```text
validated request
      │
      ▼
Action intent ── no Environment proof
      │ submit once
      ▼
Environment receipt ── Observation + all Raw Frames durably complete
      │ validate/index
      ▼
Turn commit ── sole normative Action completion Evidence
      │
      ▼
Pi tool settlement / next model context
```

这个次序有两个故意的“不等价”关系：

- Pi `effect_pending` 不等于 Action 已执行；
- Environment receipt 不等于模型已经看到结果，但足以让 controller 在不重发 Action 的情况下完成 Turn commit。

Turn commit 必须位于 Pi tool settlement 之前。若两者之间崩溃，AgentHarness 可能生成 interrupted tool result，但 ARC recovery envelope 可以从 domain ledger 交付实际结果。反向次序不可接受：若先向模型结算工具，再落 Environment Evidence，模型可能继续 Action，而审计没有权威前态。

## 3. 为什么选择 fail-closed

未确认 Action 有三个方案：

| 方案 | 优点 | 不可接受的风险 |
| --- | --- | --- |
| 自动重发 | 可能继续 Run | 同一个点击/RESET 执行两次，破坏实验与 Attempt 语义 |
| 从 Turn 0 重放日志重建 | 理论上可恢复 sidecar | 假设 Environment 完全确定、版本相同且所有历史 Action 已确认；v1 没有证据支持 |
| Unknown Outcome 后终止 | 丢失可继续性 | 不伪造状态，也不把潜在双执行写成成功 |

因此 v1 选择第三项。唯一例外不是 replay：仍存活的同一 Environment 实例权威证明 actionId 从未被接受且 anchor 未变化，此时才允许首次提交。

## 4. Pi 0.86 能力映射

| Pi 行为 | `pi-arc` 使用方式 | 不能推导出的保证 |
| --- | --- | --- |
| `AgentHarness.create()` 返回 open operation inventory，不自动 drive | attach 后先验证 Run/Environment anchor，再决定是否 drive | open operation 不证明 Environment 仍存在 |
| stable invocation ID 和 memo | safe 工具重复执行与同 invocation 去重 | memo commit 前的外部效果仍可重复 |
| `replay: "safe"` / `replay: "never"` | 所有 `play` 为 never；读工具/条件式替换为 safe | never 只阻止 Harness 重放，不会自动恢复 ARC Observation |
| tool progress checkpoint | 可保留 effect-pending 的最新有限进度 | checkpoint 不证明 Action 完成 |
| outcome staging 与 immutable result | 防止已结算工具重复执行 | Pi result 不是 Environment receipt/Turn commit |
| assistant partial frames 和 captured retry policy | provider 中断不触发不完整 tool call | provider request durability 不等于 Game durability |
| lane `watch()` | runtime 状态观察 | `watchSession()` 当前未实现，不能依赖 |

## 5. Environment adapter 的最小行为

本轮不决定 sidecar transport 或类结构，但正确性要求 adapter 具有以下可观察能力：

1. 一个活 Environment 实例拥有唯一 identity。
2. Action 严格串行，并带 stable actionId 与 base anchor。
3. adapter 在发布 receipt 前完成 Observation/Raw Frame 的逻辑 commit marker。
4. 同一实例可查询 actionId 状态，并对重复的同 actionId 返回原 receipt，而不再次 step/reset。
5. base anchor 或相同 actionId 参数冲突时拒绝。

这不构成跨实例 exactly-once。实例丢失后，新实例不得继承 identity；v1 也不靠 Action replay 恢复非终局状态。

## 6. Recovery anchor

一个可继续的 active Run 至少需要四方一致：

```text
Run binding lastTurn/digest
          = Environment instance current anchor
          = latest Turn commit
          = model recovery envelope anchor
```

Pi lane/session 是第五个 runtime 关联，但不是游戏状态权威。若 Pi operation 落后于 Turn commit，模型可以通过 recovery envelope 追上；若 Pi operation 超前并声称存在没有 Turn commit 的 `play` 结果，则属于矛盾/损坏，禁止继续。

AgentHarness v4 默认可并行执行同一 assistant response 的 tool calls，但这与“模型必须看到一个 `play` 的结果后才能执行下一 Action”冲突。因此 `pi-arc` 必须选择公开的 sequential tool execution，并在第一个 `play` 后拒绝该 response 的剩余调用；仅设置 sequential 而继续执行第二个 `play` 仍然不满足契约。

## 7. checkpoint 与 RESET 的共同结构

两者都会形成 Context Boundary，但副作用不同：

| 边界 | 改变 Environment | 可重复的部分 | 不可重复的部分 |
| --- | --- | --- | --- |
| RESET | 是 | 已提交 reset envelope 的交付 | RESET Action 本身 |
| checkpoint/Compaction | 否 | checkpoint 保存（同 invocation/anchor）与 envelope 交付 | 无 Environment Action |
| runtime Recovery | 否 | 已确认 anchor 的 envelope 交付 | pending `play` |

RESET 的 retry_state 必须与 Action intent 同一个 logical commit 写为 pending，并在 reset receipt/Turn commit 前保持 pending，避免 RESET 失败时提前覆盖旧 Attempt 的 WORKING。checkpoint 则必须在 gate 下完成完整 marker；零散文件不能成为恢复输入。

## 8. 迟到结果

terminal record 是因果边界而不是“当前最佳猜测”。如果 Unknown Outcome 终止后迟到 receipt 表明 Action 实际完成，审计应同时保留：

- 当时缺少 Evidence、因此正确 fail-closed 的事实；
- 后来收到的环境结果及时间；
- 没有执行任何后续 Action 的事实。

把 terminal 从 Unknown Outcome 改为 WIN 会抹去当时的安全决策，并使外部调用者看到随时间变化的最终结果，因此禁止改写，只允许追加 post-termination Evidence。

## 9. 尚未决定的物理设计

- domain ledger 是 JSONL、SQLite 还是其他事务介质；
- Raw Frame 写入、fsync、digest 和 commit marker 的具体顺序；
- sidecar 是子进程、守护进程还是其他本地隔离单元；
- 同实例 reconnect timeout 和 health protocol；
- recovery envelope 的 wire schema；
- logical records 到 artifact 文件名的映射。

这些实现选择必须满足唯一规范中的 crash positions 和故障矩阵，不能改变 fail-closed 语义。
