---
status: blocked
blocked-by: WP-06 acceptance
---

# WP-07：模型工具与知识边界

## 目标

实现 provider-neutral 的 `play`、视觉/history、GUIDE/WORKING 和 checkpoint contract，以及 RESET/Context Boundary knowledge staging。不得启动 AgentHarness 或真实 provider。

## 必须交付

- 全部工具的 exact input/output、限制、normal/reject/terminal 场景；
- history/inspect/read_pixels 的 artifact-only reads；
- prediction-before-play prompt contract 与 result evidence；
- GUIDE/WORKING versioned replacement、stable invocation/anchor safe replay；
- RESET pending retry_state activation、checkpoint gate/commit/delivery replay。

## 验证责任

T-HISTORY-001、T-PREDICT-001、T-TOOLS-001/002、T-NOTE-001、T-SAFE-REPLAY-001、T-RESET-001..003、T-CHECKPOINT-001..003。

## 验证命令

```text
npm run test:ts
npm run test:contract
npm run check:types
npm run check
git diff --check
```

## 停止点

展示每个工具三类场景、knowledge version 冲突和 boundary replay 证明后暂停。不得接入 Pi runtime。
