---
status: blocked
blocked-by: WP-07 acceptance
---

# WP-08：Pi runtime adapter 与 Recovery

## 目标

接入 stable AgentHarness v4 和公开 `pi-ai` Models，把 provider-neutral tools 映射到 sequential tool loop，并实现 runtime/Environment anchor Recovery。所有 tests 使用 faux Models。

## 必须交付

- exact 0.86.0 public imports；禁止 Pico3、private ModelRuntime 和 `watchSession()`；
- sequential execution、same-response single `play`、后续 `observation_required`；
- `play: never`、safe replay/memo、open operation inventory 与 recovery envelope；
- model partial/failure/no-progress、Pi settlement lag 和 Environment anchor mismatch；
- runtime events 进入脱敏 artifact record，不覆盖 domain Evidence。

## 验证责任

T-PI-001、T-MODEL-001、T-PI-BOUNDARY-001、T-REPLAY-001、T-RECOVERY-001/002、T-MODEL-FAIL-001/002、T-TOOL-ORDER-001/002。

## 验证命令

```text
npm run test:ts
npm run test:integration
npm run check:types
npm run check
git diff --check
```

## 停止点

展示 faux transcript、open-operation recovery、single-play ordering 和 no-private-import 证明后暂停。不得实现最终 CLI composition。
