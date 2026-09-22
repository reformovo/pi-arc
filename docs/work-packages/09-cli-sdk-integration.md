---
status: blocked
blocked-by: WP-08 acceptance
---

# WP-09：CLI、SDK 与 offline integration

## 目标

组装公开 CLI/SDK、真实本地 TypeScript host/Python sidecar 进程、fake Game 和 faux Models，完成无网络端到端行为。不得调用真实 provider 或 official catalog。

## 必须交付

- `run`/`resume`/`audit` exact flags、JSONL event、stdout/stderr、退出码；
- SDK 根导出、RunInvocationResult/RunResult/AuditResult/readEvents；
- happy path、GAME_OVER/RESET/WIN、启动拒绝、已知失败、Unknown Outcome 和 audit failure；
- controlled clock/ID、temporary artifact root、network/secret sentinel 和 clean process teardown；
- CLI 与 SDK 对同一 fixture 产生同一领域结果。

## 验证责任

T-CLI-001/002、T-SDK-001/002、T-CLI-CONTRACT-001、T-CLI-EVENT-001、T-CLI-EXIT-001、T-SDK-CONTRACT-001、T-SECRET-001、T-OFFLINE-001、T-NETWORK-001、T-SECRET-002。

## 验证命令

```text
npm run test:contract
npm run test:integration
npm run test:ts
npm run test:py
npm run check
git diff --check
```

## 停止点

展示各退出码、最终 event、artifact audit、sentinel 自测和进程泄漏检查后暂停。不得进行真实下载或旧项目退役。
