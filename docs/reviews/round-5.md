# 第 5 轮评审记录：规范收敛与反向审阅

> 状态：已通过（2026-09-22）。本文是评审记录，不是实现契约。

## 本轮基线

- Pi 仍位于 `d1230ea2000d876b479a69b8b061f9d670f262f5`（`v0.86.0-2-gd1230ea20`），工作树干净；`pi-agent-core`/`pi-ai` 均为 0.86.0，且 `v0.86.0..HEAD` 对两者的 `src` 与 package manifest 没有差异，因此精确依赖仍可固定到已发布的 0.86.0。
- stable `AgentHarness` 根导出、sequential tool execution、`replay: "safe" | "never"`、lane watch、公开 `pi-ai` Models/CredentialStore surface 均仍存在。
- `watchSession()` 仍抛出 `SliceNotImplemented`；Pico3 仍从 experimental 路径导出，因此没有改变 runtime 选择。
- VISTA 证据仍定位到已提交的 `63c8843822cb371bb52a59f0cee18c4020f2494b`，本轮没有写入 VISTA、Pi 或三个旧项目。

## 十项反向审阅

| 审阅 | 发现 | 处理 |
| --- | --- | --- |
| 1. 术语一致性 | Retry、Recovery 已定义，但规范大量使用 Replay 且词汇表缺项 | 在 `CONTEXT.md` 增加 Replay，明确区分首次提交和结果重新交付 |
| 2. 目标与非目标 | 实时 callback、直接工具驱动、任意 attach 没有核心需求支撑 | 从 v1 删除并明确列入非目标 |
| 3. VISTA 行为覆盖 | 核心工具、视觉、全 Frame、知识、RESET/checkpoint 和预测核对均已覆盖 | 保留；固定原先“建议”的工具上限 |
| 4. Pi 0.86 API 可行性 | runtime/模型边界仍被写成“候选”，与已确认选择矛盾 | 固定 stable AgentHarness v4 和公开 `pi-ai`；新增 proposed ADR 0002/0003 |
| 5. 故障与竞态 | crash matrix 完整，但 sidecar message family 未固定 | 提出 v1 envelope、request type 与 receipt status contract |
| 6. 安全重放与未知结果 | safe replay 的 anchor 条件已定义，但 Replay 未单独释义 | 补词汇和 R-044 引用；`play`/RESET 规则不变 |
| 7. 审计完整性 | 只有逻辑产物，稳定入口、schema major 和篡改检测未固定 | 提出八个入口、hash-linked domain ledger 和 write-once terminal |
| 8. 最小性 | 交互式 OAuth、provider 私有改写、Windows 和旧项目删除会扩大 v1 | 明确排除；旧项目退役继续作为跨项目 gate |
| 9. 可测试性 | R-001–R-060 有映射，但新增公开 contract 需要 focused ID | 新增 12 个 static/test/manual validation ID |
| 10. 文档矛盾 | 精确质量版本只在“非实现契约”证据中；规范仍有旧 gated 描述 | 将精确版本/actions/scripts 写回唯一规范，并对遗留 gate 逐项处置 |

## 本轮提出的规范修订

1. 固定 runtime 依赖：`pi-agent-core`/`pi-ai` 0.86.0、`arc-agi` 0.9.9、`arcengine` 0.9.3、Pillow 12.2.0。
2. 固定工具 input/output logical fields、Unicode 长度上限和最新 Pi 支持到 `max` 的 thinking level；固定 CLI 为 `run`、`resume`、`audit`，定义 flags、JSONL envelope、event type 和退出码 0/2/3/10/20/30。
3. 固定 SDK 根导出与 `run`/`resume`/`audit`/`readEvents` 能力；移除私有 Pi 类型、raw key、direct tool driving 和非 durable callback。
4. Game 只按完整 versioned ID 从 `arc-agi` official public catalog 获取；cache 用 canonical file manifest 与 SHA-256 tree digest 验证，seed 固定为 42；下载代码只在 SDK offline、无 provider secret/proxy/network client、无 Pi session/artifact root 的 sidecar 中加载。
5. 固定 Run artifact 八个公开入口、versioned schema family、Raw Frame/Visual 路径、hash-linked domain ledger、write-once terminal 和可重建 audit。
6. 固定 sidecar `open`/`get_anchor`/`submit_action`/`lookup_action`/`close` 以及 `not_accepted`/`pending`/`complete` receipt；transport 和物理 cache 保持可替换实现选择。
7. 将第 4 轮精确工具版本、GitHub Actions SHA、lock/install 与 script 名写入唯一规范，避免依赖非规范设计证据。

## ADR 处置

- ADR 0001 保持 `accepted`：未确认 Environment Action fail-closed。
- ADR 0002 为 `proposed`：stable AgentHarness v4 优先于 Pico3。
- ADR 0003 为 `proposed`：模型接入只依赖公开 `pi-ai`。
- 质量工具未建 ADR，因为可逆且没有架构 lock-in。
- 旧项目退役 ADR 现在不创建：删除不可逆且跨项目，必须等新实现、重新获取数据和等价性验收完成后，写入 `memo-docs` 并单独获得用户批准。

## Gated 内容处置

| 原 gated 项 | 第 5 轮处置 |
| --- | --- |
| CLI/SDK exact surface | 由规范 15.4、15.5 节关闭 |
| Game source/cache/digest | 由规范 15.6 节关闭 |
| artifact file/schema | 由规范 15.7 节关闭 |
| sidecar wire | 行为 contract 由规范 15.8 节关闭；transport/介质降为内部可替换选择 |
| provider OAuth/private options | 明确排除出 v1 |
| 旧项目退役 | 保持跨项目 gated，不进入首个 implementation handoff |

## 本轮通过前没有做的事

- 用户确认前没有把规范状态改成 `accepted`，也没有提前接受 ADR 0002/0003。
- 没有创建 implementation handoff 或 `docs/work-packages/`。
- 没有创建源码、配置、lockfile、CI workflow、fixture、schema 或 game cache。
- 没有安装或运行候选工具，没有调用真实模型或 official Game catalog。
- 没有删除或修改 `memo-arc`、`memo`、`pi-memo`。

## 审阅结论

用户于 2026-09-22 确认第五轮审核通过：

1. 接受 Replay 定义、十项反向审阅结论和最小性删减；
2. 接受 runtime 精确依赖以及 ADR 0002/0003，并将两者标记为 `accepted`；
3. 接受工具 input/output shape、CLI command/flag、JSONL event、退出码和 SDK surface；
4. 接受 official `arc-agi` Game source、完整 versioned ID、seed 42、cache manifest 和 SHA-256 tree digest；
5. 接受八个 artifact 入口、hash-linked ledger、write-once terminal 和 sidecar wire/receipt contract；
6. 批准将 `docs/pi-arc.md` 标记为 `accepted`，随后只生成 implementation handoff 供下一次审阅，仍不开始编码。

implementation handoff 仍需用户再次明确批准，才能进入第一个“项目骨架和质量门禁”work package。
