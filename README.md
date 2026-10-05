# pi-arc

`pi-arc` 是一个面向冻结本地 ARC-AGI-3 游戏的 Pi agent 宿主。规范与 implementation handoff 已接受；WP-01 至 WP-08 已完成基础设施、环境与控制器、模型工具及 Pi runtime/recovery。WP-09 CLI/SDK 已通过离线门禁和用户验收。

## 当前状态

- 阶段：WP-01 至 WP-09 已通过审阅；WP-10 等待单独授权
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
- accepted ADR：[docs/adr/0005-official-sdk-acquisition-trust.md](docs/adr/0005-official-sdk-acquisition-trust.md)
- 需求追踪：[docs/design/requirements-traceability.md](docs/design/requirements-traceability.md)
- 第 0 轮评审：[docs/reviews/round-0.md](docs/reviews/round-0.md)
- 第 1 轮评审：[docs/reviews/round-1.md](docs/reviews/round-1.md)
- 第 2 轮评审：[docs/reviews/round-2.md](docs/reviews/round-2.md)
- 第 3 轮评审：[docs/reviews/round-3.md](docs/reviews/round-3.md)
- 第 4 轮评审：[docs/reviews/round-4.md](docs/reviews/round-4.md)
- 第 5 轮评审：[docs/reviews/round-5.md](docs/reviews/round-5.md)
- 当前 handoff：[docs/implementation-handoff.md](docs/implementation-handoff.md)
- 当前 work package：[docs/work-packages/09-cli-sdk-integration.md](docs/work-packages/09-cli-sdk-integration.md)
- 当前评审与剩余验收：[docs/reviews/wp-09.md](docs/reviews/wp-09.md)
- WP-01 评审材料：[docs/reviews/wp-01.md](docs/reviews/wp-01.md)
- WP-02 评审材料：[docs/reviews/wp-02.md](docs/reviews/wp-02.md)
- WP-03 评审材料：[docs/reviews/wp-03.md](docs/reviews/wp-03.md)
- WP-04 评审材料：[docs/reviews/wp-04.md](docs/reviews/wp-04.md)
- WP-05 评审材料：[docs/reviews/wp-05.md](docs/reviews/wp-05.md)

## 本地构建与使用

使用项目锁定的 Node 22.23.1、npm 10.9.8、uv 0.8.12 与 Python 3.12.9，先安装依赖并验证，再显式构建：

```bash
npm ci --ignore-scripts --no-audit --no-fund
uv sync --locked --all-groups --python 3.12.9
npm run check
npm run build
```

构建后可运行 `node dist/composition/cli.js run|resume|audit`；SDK 从包根导入 `createPiArcHost`，由调用者传入公开 `pi-ai` Models。CLI flags、JSONL 和退出码以[规范第 15.4 节](docs/pi-arc.md#154-无头-cli-的精确-surface)为准。`audit` 不创建 Environment 或调用模型。

`run --game-offline` 要求已验证的 Game cache，仅禁止 Game 获取网络，不禁止模型网络。未启用该 flag 时，cache miss 会通过官方 SDK 获取；可通过环境提供 `ARC_API_KEY`，缺省走 SDK 匿名路径，不把 key 放入 argv。真实下载与真实模型调用不属于 required checks，仍须明确授权。当前验证范围为 fake Game + faux Models，未证明生产 catalog 网络连通性。

## 文档权威顺序

1. 状态为 `accepted` 的 `docs/pi-arc.md` 是唯一行为规范。
2. accepted ADR 解释难以逆转的决策及其原因；若行为表述与规范冲突，必须先修正规范或 ADR，不能由实现者自行裁决。
3. implementation handoff 只在引用的规范基线上有效。
4. `docs/design/` 是设计证据，`docs/reviews/` 是评审记录，二者都不是实现契约。

`docs/pi-arc.md` 与 implementation handoff 最初于 2026-09-22 accepted；ADR 0001..0005 均为 accepted，当前规范基线为 `pi-arc-v1-adr-0005`。WP-01 至 WP-09 已通过审阅。用户已确认信任官方 Game 并接受获取阶段接触 ARC 凭据，原 SDK 获取契约冲突已解除；WP-09 于 2026-10-06 获得用户验收与提交授权，WP-10 等待单独实施授权，保持 `blocked`。

## 当前禁止事项

- WP-10 未单独获授权前不得开始；不得把获取阶段的 SDK Environment 实例作为正式 Run 实例。
- required checks 不访问 official catalog 或下载真实 Game；只使用 committed minimal fixture 与注入的 fake catalog。
- 后续真实获取只能通过统一 Game resolver；不得从 `memo-arc`、`memo` 或 `pi-memo` 复制或 fallback 到旧 game 资产。
- 不删除或改写 `memo-arc`、`memo`、`pi-memo`。
- 不修改作为证据来源的 `VISTA`、`pi` 和 `memo-docs` 工作树。
- 不把聊天记录或设计证据当作缺失规范的替代品。
