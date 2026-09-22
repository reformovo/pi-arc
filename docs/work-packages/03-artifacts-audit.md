---
status: blocked
blocked-by: WP-02 acceptance
---

# WP-03：Artifact ledger 与独立审计

## 目标

实现规范 15.7 节的 artifact entry points、append-only hash chain、Raw Frame/Visual 引用、write-once terminal、late Evidence 和只读 audit。仅使用确定性 fake records，不创建 Environment 或模型 runtime。

## 必须交付

- manifest/domain/runtime/frame/visual/knowledge/terminal/audit 的 durable store boundary；
- atomic publish、partial-write detection、sequence/hash-chain validation 和 deterministic audit rebuild；
- terminal immutability、post-terminal append、archive corruption 和 storage fault injection；
- 独立 audit reader，不导入 controller、Pi 或 Python Environment 实现。

## 验证责任

T-ARTIFACT-SCHEMA-001、T-LEDGER-CHAIN-001、T-AUDIT-001/002、T-EVIDENCE-001/002、T-STORAGE-001/002、T-TERMINAL-001、T-LATE-001。

## 验证命令

```text
npm run test:ts
npm run test:contract
npm run check:spec
npm run check
git diff --check
```

## 停止点

展示每个 crash position、篡改样例、audit 重建结果和 tracked diff 后暂停。不得引入 game resolver 或 sidecar。
