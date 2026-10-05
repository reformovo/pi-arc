---
status: accepted
completed: 2026-10-05
accepted: 2026-10-06
spec-baseline: pi-arc-v1-adr-0005
started: 2026-09-24
previously-blocked: 2026-10-03
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

## 当前设计决策与验收

用户已接受 [ADR-0005](../adr/0005-official-sdk-acquisition-trust.md)：允许独立官方 SDK 获取进程加载官方 Game 并接触 ARC 下载凭据。原隔离契约冲突已解除。本包实现及离线验证已收尾：完成获取进程凭据过滤、获取实例与正式 Run 分离、正式 offline sidecar 不获得 ARC key，且支持 SDK 匿名获取路径。完整 check/build 与构建后 SDK/CLI smoke 通过；详见 [WP-09 评审记录](../reviews/wp-09.md)。用户已于 2026-10-06 审核通过并授权提交本包。

## 停止点

展示各退出码、最终 event、artifact audit、sentinel 自测和进程泄漏检查后暂停。不得进行真实下载或旧项目退役。本包已通过用户审阅；WP-10 仍须另获用户授权，不因本次提交自动开始。
