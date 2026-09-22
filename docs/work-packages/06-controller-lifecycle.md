---
status: blocked
blocked-by: WP-05 acceptance
---

# WP-06：Run lifecycle 与 Action controller

## 目标

实现 Run/Game/Level/Attempt/Turn 状态机、Action intent → receipt → Turn commit 三段协议、终止 admission gate、Unknown Outcome 和取消语义。只通过 ports 使用 artifact store 与 fake sidecar，不接入 Pi。

## 必须交付

- 初始 Observation/Turn 0、Level/Attempt/WIN/GAME_OVER 生命周期；
- 单 pending Action、base anchor、intent/receipt/commit 和 reconciliation；
- intent 前后六个 crash side、Unknown Outcome fail-closed、no Action-log rebuild；
- cancel/storage/late-result coordination 与 terminal reason；
- controller 不依赖具体 filesystem、Python transport 或 Pi adapter。

## 验证责任

T-RUN-001、T-LIFECYCLE-001/002、T-EFFECT-001..006、T-UNKNOWN-001、T-CANCEL-001/002。

## 验证命令

```text
npm run test:ts
npm run test:contract
npm run check:types
npm run check
git diff --check
```

## 停止点

逐行展示 effect/crash matrix 结果和每个 terminal classification 后暂停。不得实现模型工具或 Pi adapter。
