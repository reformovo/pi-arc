---
status: accepted
spec-baseline: pi-arc-v1-2026-09-22
spec-sha256: 1d9a8039c0963ed25dbf6ce2295bc70121bb688cb34965d802ddbb5dcef83b02
created: 2026-09-22
accepted: 2026-09-22
---

# pi-arc v1 implementation handoff

本文件把 accepted 规范拆成可执行 work package。用户已于 2026-09-22 批准本 handoff 并授权 WP-01；每个后续 package 仍须在前一 package 完成并通过用户审阅后单独开始。

## 1. 权威基线

- 唯一规范：[`docs/pi-arc.md`](pi-arc.md)，状态 `accepted`，SHA-256 `1d9a8039c0963ed25dbf6ce2295bc70121bb688cb34965d802ddbb5dcef83b02`。
- 领域语言：[`CONTEXT.md`](../CONTEXT.md)。
- accepted ADR：[`0001`](adr/0001-unconfirmed-environment-action.md)、[`0002`](adr/0002-stable-agent-harness-v4.md)、[`0003`](adr/0003-public-pi-ai-boundary.md)。
- 质量命令与依据：[`quality-gates.md`](design/quality-gates.md)。
- 需求与验证：[`requirements-traceability.md`](design/requirements-traceability.md)、[`verification-matrix.md`](design/verification-matrix.md)。
- Pi 证据：HEAD `d1230ea2000d876b479a69b8b061f9d670f262f5`；`pi-agent-core`/`pi-ai` 0.86.0；`v0.86.0..HEAD` 无 agent/ai source 或 manifest 差异。
- VISTA 证据：提交 `63c8843822cb371bb52a59f0cee18c4020f2494b`，只作行为证据，不作 dependency 或复制来源。

若规范文件 SHA-256 变化，本 handoff 自动失效；必须先记录规范变更、重新审阅并更新基线，不能在实现中自行调和。

## 2. 开发纪律

1. WP-01 之前不得创建业务源码、依赖、配置、lockfile 或 CI；本 handoff 获批才构成 WP-01 授权。
2. 一次只执行一个 work package。完成其验收、展示差异和留下评审记录后必须暂停。
3. 测试/fixture 与行为同包落地；禁止把契约测试推迟到最终包。
4. required checks 始终只读。修复命令必须显式执行，不能藏在 check、test 或 hook 中。
5. required tests 禁止真实模型、provider secret、官方 Game 下载和非 sentinel 网络。
6. 发现 accepted 规范不可实现或互相矛盾时立即停止，先回到设计评审；handoff 不得新增公开行为。
7. 不自动创建 Git commit。`memo-arc`、`memo`、`pi-memo`、VISTA、Pi 和 `memo-docs` 在全部 package 中保持只读。

## 3. 明确非目标

- 交互式 OAuth/login、provider 私有 request 改写、自定义 provider plugin；
- Pico3、`watchSession()`、跨 Run 经验、ALFWorld、批量竞赛、GUI、远程 control plane 和 Windows；
- SDK direct tool driving、非 durable callback 和任意跨进程 attach；
- 从旧项目迁移源码、game、fixture 或运行材料；
- 删除旧项目。WP-10 只生成退役就绪证据，不执行删除。

## 4. Work package 顺序

| Package | 目标 | 前置 | 审阅停点 |
| --- | --- | --- | --- |
| [WP-01](work-packages/01-project-quality.md) | 项目骨架和全部质量门禁 | handoff accepted | 所有 meta-gate 通过，无 ARC 业务逻辑 |
| [WP-02](work-packages/02-contracts-fixtures.md) | versioned schemas、canonical JSON、共享 fixtures | WP-01 accepted | 双端 contract corpus 通过 |
| [WP-03](work-packages/03-artifacts-audit.md) | artifact ledger、Raw Frame store、terminal/audit | WP-02 accepted | crash/tamper/audit tests 通过 |
| [WP-04](work-packages/04-game-visual.md) | Game resolver/cache、Raw Frame validation、1024 Visual | WP-03 accepted | offline fake resolver/visual tests 通过 |
| [WP-05](work-packages/05-sidecar.md) | Python sidecar wire、receipt、containment | WP-04 accepted | 双端 sidecar/crash tests 通过 |
| [WP-06](work-packages/06-controller-lifecycle.md) | Run 生命周期和 Action 三段协议 | WP-05 accepted | lifecycle/effect/Unknown Outcome tests 通过 |
| [WP-07](work-packages/07-tools-knowledge.md) | 模型工具、GUIDE/WORKING、RESET/checkpoint | WP-06 accepted | tool/knowledge/boundary tests 通过 |
| [WP-08](work-packages/08-pi-runtime-recovery.md) | AgentHarness/`pi-ai` adapter 与 Recovery | WP-07 accepted | Pi/replay/model-failure tests 通过 |
| [WP-09](work-packages/09-cli-sdk-integration.md) | CLI/SDK composition 与 offline integration | WP-08 accepted | CLI/SDK/end-to-end offline tests 通过 |
| [WP-10](work-packages/10-final-conformance.md) | 全矩阵、跨平台和退役就绪报告 | WP-09 accepted | 全门禁与人工证据通过；不删除旧项目 |

Package 不得合并、跳过或并行实现。若一个 package 过大，应先回到 handoff 评审拆分，不能静默扩大相邻 package。

## 5. 验证 ID 分配

| Package | 主要验证 ID |
| --- | --- |
| WP-01 | S-REPO-001、S-SPEC-001/002、S-TOOLS-001、S-LOCK-001、S-READONLY-001、S-COVERAGE-001、S-BOUNDARY-001..004、T-BOUNDARY-CHECK-001、S-DEPS-001..003、S-ASSET-002、S-CI-001、S-RUNTIME-PINS-001、S-TRACE-001、M-PROCESS-001、M-HANDOFF-001、M-ROUND5-001、M-ADR-001 |
| WP-02 | T-JSON-CANONICAL-001、T-SCHEMA-CORPUS-001、S-GENERATED-001 |
| WP-03 | T-ARTIFACT-SCHEMA-001、T-LEDGER-CHAIN-001、T-AUDIT-001/002、T-EVIDENCE-001/002、T-STORAGE-001/002、T-TERMINAL-001、T-LATE-001 |
| WP-04 | S-ASSET-001、T-DATA-001、T-GAME-RESOLVER-001、T-GAME-DIGEST-001、T-COORD-001、T-VISUAL-001/002 |
| WP-05 | T-SIDECAR-001..004、T-SIDECAR-CONTRACT-001、T-SIDECAR-RECEIPT-001、T-SIDECAR-CONTAINMENT-001 |
| WP-06 | T-RUN-001、T-LIFECYCLE-001/002、T-EFFECT-001..006、T-UNKNOWN-001、T-CANCEL-001/002 |
| WP-07 | T-HISTORY-001、T-PREDICT-001、T-TOOLS-001/002、T-NOTE-001、T-SAFE-REPLAY-001、T-RESET-001..003、T-CHECKPOINT-001..003 |
| WP-08 | T-PI-001、T-MODEL-001、T-PI-BOUNDARY-001、T-REPLAY-001、T-RECOVERY-001/002、T-MODEL-FAIL-001/002、T-TOOL-ORDER-001/002 |
| WP-09 | T-CLI-001/002、T-SDK-001/002、T-CLI-CONTRACT-001、T-CLI-EVENT-001、T-CLI-EXIT-001、T-SDK-CONTRACT-001、T-SECRET-001、T-OFFLINE-001、T-NETWORK-001、T-SECRET-002 |
| WP-10 | T-FAULT-MATRIX-001、S-HISTORY-001、M-BRANCH-001、M-RETIRE-001，以及 WP-01..09 全部验证 ID 的最终回归 |

这里的 `001..NNN` 表示包含端点的连续 ID。验证 ID 只由上表一个 package 首次负责关闭，之后仍随 `npm run check` 持续回归。

## 6. 稳定验证命令

WP-01 必须创建且自证以下命令；之后每个 package 在 focused commands 后都运行 `npm run check`：

```text
npm ci --ignore-scripts --no-audit --no-fund
uv sync --locked --all-groups --python 3.12.9
uv lock --check
npm run check:dependencies
npm run check:format-lint
npm run check:types
npm run test:ts
npm run test:py
npm run test:contract
npm run test:integration
npm run check:spec
npm run check
git diff --check
git status --short
```

`npm run check` 不得下载 Game、读取真实 credential、访问网络、修改 tracked 文件或自动 retry flaky test。WP-01 的 contract/integration commands 必须用最小 meta-fixture 证明 runner、network/secret sentinel 和 TS↔Python test plumbing 有效，不能使用 `passWithNoTests`。

## 7. Handoff 审阅条件

批准本 handoff 表示只授权 WP-01，不授权 WP-02..10。审核人应确认：

1. spec SHA、必读文档和非目标准确；
2. package 顺序没有提前实现 ARC 业务逻辑；
3. 每个 verification ID 已分配且高风险项属于自动化测试；
4. WP-01 有可执行命令、明确完成定义和停止点；
5. 旧项目删除、真实模型和真实 Game 下载没有被隐式授权。

本 handoff 已被批准；WP-01 已获授权，其余 package 保持 `blocked`。任何实现开始前仍应记录当时工作树状态，但不得擅自提交 Git commit。
