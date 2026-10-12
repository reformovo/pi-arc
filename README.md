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

### OpenAI-compatible / VISTA 对比配置

当前真实验证默认使用 DeepSeek 官方渠道，OpenCode Go 暂停；其接入与历史记录保留作对照。复制 `.env.example` 为 `.env`（若已有则不要覆盖）；示例默认 DeepSeek 官方地址，未来 OpenCode Go 对比需单独授权、先改为 Go 地址并使用 `opencode-go`。填写 `OPENAI_API_KEY`（不再使用旧配置名 `OPENCODE_API_KEY`）；`ARC_API_KEY` 可选。用 `node --env-file=.env` 显式加载，shell 中已有变量优先。不要在示例文件中填写真实密钥。

```bash
node --env-file=.env dist/composition/cli.js run \
  --game-id cd82-fb555c5d --game-cache ./game-cache \
  --provider deepseek --model deepseek-flash --thinking max \
  --action-budget 400 --artifacts ./run-artifacts/cd82-official-first
```

`OPENAI_BASE_URL=https://opencode.ai/zen/go/v1` 与 `OPENAI_API_KEY` 配对使用。官方地址 `https://api.deepseek.com` 使用 `deepseek` provider，OpenCode Go 地址使用 `opencode-go` provider；两者都发送 `deepseek-flash`，但必须填写对应服务自己的密钥。不得把 OpenCode key 发到 DeepSeek。其他 provider 的默认认证不受影响；不改写 provider payload。历史 alias 的实际能力仍须真实试运行确认；费用元数据仅沿用目录估算，不代表 alias 的实际计费。未配置时保持内置目录。URL 必须是无凭据、query 或 fragment 的 HTTP(S) base URL。SDK 调用者仍自行传入 Models，不隐式读取这个变量。

`run --game-offline` 要求已验证的 Game cache，仅禁止 Game 获取网络，不禁止模型网络。未启用该 flag 时，cache miss 会通过官方 SDK 获取；可通过环境提供 `ARC_API_KEY`，缺省走 SDK 匿名路径，不把 key 放入 argv。真实下载与真实模型调用不属于 required checks，仍须明确授权。required checks 仍只使用 fake Game + faux Models。2026-10-08 的独立授权真实测试已通过官方获取，并以 `opencode-go/deepseek-flash` 完成 `cd82-fb555c5d`（134 Action、6/6、WIN、audit=true）；该结果早于后续 checkpoint 修复，不代表新策略已通过真实 provider 验证。

### 上下文与诊断

上下文策略按 VISTA 模型窗口预留量触发：normal=`contextWindow-72000`，checkpoint=`contextWindow-32000`（100 万窗口为 928000/968000）。以完整 input+cacheRead+cacheWrite 判断，不使用扣除缓存后的 input。先暂停普通工具，在旧上下文保存 ARC checkpoint，再通过公开 Pi 导航进入真正的新上下文并交付权威记录、GUIDE/WORKING 和当前最终图像；不直接修改 provider payload。OpenCode Go DeepSeek 的独立 64 图片兼容上限通过图片容量 checkpoint 执行：`play` 预留1图、`inspect` 预留实际视图数（最多16）；不足则先保存checkpoint进入新Context，不滚动替换已发送历史图片。其他provider不推断该64上限。恢复已接纳工具结果先结算；超容旧Context的provider请求被公开effect gate阻断。

runtime 指标通过 `payload.phase=provider_request` 区分每次 provider request 与外层 operation；usage、图片数和耗时不包含正文或凭据。实现、已修复问题与未验证项见 [审计报告](docs/reviews/real-run-audit-2026-10-08.md) 和 [VISTA 对齐设计](docs/design/real-run-context-follow-up.md)。

## 实测基线与后续策略

本阶段修复、诊断工具与验收分类见 [阶段基线](docs/reviews/stage-baseline-2026-10-12.md) 和 [问题关闭清单](docs/reviews/issue-closure-checklist-2026-10-10.md)。官方 cd82（121 Action）和 ft09（227 Action 含一次 RESET）均完成 6/6 并通过 audit；最小官方坐标契约 probe 也通过。单次结果不代表与 VISTA 同后端、同 seed 的稳定优势，token 容量 checkpoint、跨平台故障与依赖告警仍有未关闭项。

离线缓存诊断现在用受检查的 `scripts/diagnose-cache.mjs`，须先 `npm run build`。各 probe 默认离线，真实模式须显式授权和 `--live`，不能把诊断 setup 重放当模型通关成绩。运行产物与 `.env` 不纳入源码提交；Git 忽略不保证共享编辑保密。

[笔记语义策略](docs/design/knowledge-summary-policy.md) 仅为下一阶段评审方案，目前没有修改 TASK/system 提示词、笔记写入频率或开启新游戏实验。

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
