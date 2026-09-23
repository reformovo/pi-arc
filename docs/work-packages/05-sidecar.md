---
status: accepted
started: 2026-09-23
completed: 2026-09-23
accepted: 2026-09-23
---

# WP-05：Python Environment sidecar

## 目标

实现规范 15.8 节 sidecar wire 行为、Environment instance identity、串行 Action、receipt lookup/dedupe 和 containment。required tests 使用 fake deterministic Environment；不接入 Pi 或模型。

## 必须交付

- `open`、`get_anchor`、`submit_action`、`lookup_action`、`close` 双端实现；
- `not_accepted`、`pending`、`complete` receipt，actionId conflict 和完整 Observation/Frames；
- receipt/response cache durable boundary、disconnect/reconnect same-instance 行为和 crash injection；
- ARC SDK offline、secret/proxy stripping、no network client、read-only cache input 和最小路径能力；
- real local TS host ↔ Python process integration，但不使用真实 Game。

## 验证责任

T-SIDECAR-001..004、T-SIDECAR-CONTRACT-001、T-SIDECAR-RECEIPT-001、T-SIDECAR-CONTAINMENT-001。

## 验证命令

```text
npm run test:py
npm run test:contract
npm run test:integration
npm run check
git diff --check
```

## 停止点

已展示双端 fixture、重复 Action 证明、断连矩阵、process cleanup 和 sentinel 结果，用户已接受 WP-05 并授权 WP-06。
