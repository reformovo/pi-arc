---
status: accepted
accepted: 2026-09-21
---

# 未确认的 Environment Action 采用 fail-closed

`play`（包括 RESET）可能在 durable settlement 前已经改变只存在于 ARC Environment 实例中的状态，而 Pi stable `AgentHarness` 明确不保证 external effect exactly-once。`pi-arc` 因此将 `play` 固定为 `replay: "never"`：只有同一 Environment 实例能权威证明 actionId 从未被接受时才允许首次提交；其余无法确认是否执行的情况都以 Unknown Outcome 终止 Run，禁止自动重发、RESET 或从 Action 日志重建。代价是牺牲部分可恢复性，换取不产生双重 Action 和虚假实验结果。
