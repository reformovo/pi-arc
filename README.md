# pi-arc

`pi-arc` 是一个面向冻结本地 ARC-AGI-3 游戏的 Pi agent 宿主。规范与 implementation handoff 已接受；WP-01 至 WP-03 已建立质量基础设施、公共 contract、artifact ledger 与独立审计，尚未实现 ARC 业务行为。

## 当前状态

- 阶段：WP-04 已通过审阅；WP-05 Python Environment sidecar 已获授权
- 领域语言：[CONTEXT.md](CONTEXT.md)
- 唯一规范：[docs/pi-arc.md](docs/pi-arc.md)
- 事实基线：[docs/design/round-0-fact-baseline.md](docs/design/round-0-fact-baseline.md)
- Pi 开发模式证据：[docs/design/pi-development-pattern.md](docs/design/pi-development-pattern.md)
- 第 1 轮场景分析：[docs/design/round-1-scenario-analysis.md](docs/design/round-1-scenario-analysis.md)
- 第 2 轮外部契约证据：[docs/design/round-2-external-contract.md](docs/design/round-2-external-contract.md)
- 第 3 轮持久性与失败分析：[docs/design/round-3-persistence-failure.md](docs/design/round-3-persistence-failure.md)
- 第 4 轮质量门禁设计：[docs/design/quality-gates.md](docs/design/quality-gates.md)
- 规范验证映射：[docs/design/verification-matrix.md](docs/design/verification-matrix.md)
- accepted ADR：[docs/adr/0001-unconfirmed-environment-action.md](docs/adr/0001-unconfirmed-environment-action.md)
- accepted ADR：[docs/adr/0002-stable-agent-harness-v4.md](docs/adr/0002-stable-agent-harness-v4.md)
- accepted ADR：[docs/adr/0003-public-pi-ai-boundary.md](docs/adr/0003-public-pi-ai-boundary.md)
- accepted ADR：[docs/adr/0004-semantic-comments.md](docs/adr/0004-semantic-comments.md)
- 需求追踪：[docs/design/requirements-traceability.md](docs/design/requirements-traceability.md)
- 第 0 轮评审：[docs/reviews/round-0.md](docs/reviews/round-0.md)
- 第 1 轮评审：[docs/reviews/round-1.md](docs/reviews/round-1.md)
- 第 2 轮评审：[docs/reviews/round-2.md](docs/reviews/round-2.md)
- 第 3 轮评审：[docs/reviews/round-3.md](docs/reviews/round-3.md)
- 第 4 轮评审：[docs/reviews/round-4.md](docs/reviews/round-4.md)
- 第 5 轮评审：[docs/reviews/round-5.md](docs/reviews/round-5.md)
- 当前 handoff：[docs/implementation-handoff.md](docs/implementation-handoff.md)
- 当前 work package：[docs/work-packages/05-sidecar.md](docs/work-packages/05-sidecar.md)
- WP-01 评审材料：[docs/reviews/wp-01.md](docs/reviews/wp-01.md)
- WP-02 评审材料：[docs/reviews/wp-02.md](docs/reviews/wp-02.md)
- WP-03 评审材料：[docs/reviews/wp-03.md](docs/reviews/wp-03.md)
- WP-04 评审材料：[docs/reviews/wp-04.md](docs/reviews/wp-04.md)

## 文档权威顺序

1. 状态为 `accepted` 的 `docs/pi-arc.md` 是唯一行为规范。
2. accepted ADR 解释难以逆转的决策及其原因；若行为表述与规范冲突，必须先修正规范或 ADR，不能由实现者自行裁决。
3. implementation handoff 只在引用的规范基线上有效。
4. `docs/design/` 是设计证据，`docs/reviews/` 是评审记录，二者都不是实现契约。

`docs/pi-arc.md` 与 implementation handoff 已于 2026-09-22 accepted；ADR 0001..0004 均为 accepted。WP-01 至 WP-04 已通过审阅；用户已授权 WP-05，WP-06 至 WP-10 继续保持 `blocked`。

## 当前禁止事项

- WP-05 不实现 Run controller、Pi runtime、CLI 或 SDK。
- required checks 不访问 official catalog 或下载真实 Game；只使用 committed minimal fixture 与注入的 fake catalog。
- 后续真实获取只能通过统一 Game resolver；不得从 `memo-arc`、`memo` 或 `pi-memo` 复制或 fallback 到旧 game 资产。
- 不删除或改写 `memo-arc`、`memo`、`pi-memo`。
- 不修改作为证据来源的 `VISTA`、`pi` 和 `memo-docs` 工作树。
- 不把聊天记录或设计证据当作缺失规范的替代品。
