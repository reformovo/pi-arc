# 规范验证映射

> 状态：设计证据，不是实现契约。第 5 轮反向审阅已通过；验证 ID 由 implementation handoff 分配到编号 work package，它们不是测试文件名。

## 1. 验证类型

- `S-*`：静态、格式、类型、依赖、生成或边界检查。
- `T-*`：自动化 unit/contract/integration 场景。
- `M-*`：必须留下评审记录的人工审阅或用户批准。

高风险运行时要求必须至少有一个 `T-*`，不能只有 `M-*`。

## 2. 需求映射

| 需求 | 验证 | 验收重点 |
| --- | --- | --- |
| R-001–R-004 | S-REPO-001、S-SPEC-001、M-PROCESS-001 | 独立仓库、中文规范、设计期 docs-only、无配置/源码/迁移 |
| R-005–R-006 | M-RETIRE-001、S-HISTORY-001 | 旧项目删除必须最终单独批准；历史文档不被新规范重写 |
| R-007 | S-BOUNDARY-001、S-DEPS-001 | VISTA 不是 dependency/import；只引用提交与证据 |
| R-008–R-010 | T-RUN-001、T-CLI-001、T-SDK-001 | 单 Game Run；无头 CLI 与 SDK 产生同一领域结果 |
| R-011–R-013 | S-DEPS-002、T-PI-001、T-MODEL-001 | stable AgentHarness/public `pi-ai`；Pico3/private runtime 不进入生产依赖 |
| R-014–R-016 | T-VISUAL-001、T-HISTORY-001、T-PREDICT-001 | 全帧、历史工具、预测—行动—核对闭环 |
| R-017–R-018 | T-RESET-001、T-CHECKPOINT-001 | retry_state/Context Boundary 与显式 checkpoint |
| R-019、R-037 | T-COORD-001、T-VISUAL-002 | 1024×1024；0/15/16/1023 映射到 0/0/1/63；全部 Raw Frame |
| R-020、R-032 | S-DEPS-003、S-BOUNDARY-002 | 无 ALFWorld、跨 Run 记忆、批量竞赛或交互式 UI |
| R-021–R-022、R-042 | T-REPLAY-001、T-UNKNOWN-001 | `play: never`；未确认 Action不重发并 fail-closed |
| R-023–R-024、R-051–R-054 | S-TOOLS-001、S-LOCK-001、S-READONLY-001 | 单一工具职责、精确版本、lockfile、CI不改源码 |
| R-025 | M-HANDOFF-001、S-SPEC-002 | accepted 前无 work package；handoff 不新增规范 |
| R-026、R-039 | T-DATA-001、S-ASSET-001 | resolver/digest/cache；旧项目副本不可 fallback |
| R-027–R-032 | T-LIFECYCLE-001、T-LIFECYCLE-002 | Run/Game/Level/Attempt/Turn、WIN和非成功终止边界 |
| R-033–R-035 | T-CLI-002、T-SDK-002、T-SECRET-001 | stdout/stderr、领域 SDK、公开 Models/CredentialStore、无 secret 泄漏 |
| R-036、R-040 | T-TOOLS-001、T-TOOLS-002 | 每个工具正常、拒绝、terminal 场景 |
| R-038 | T-AUDIT-001、T-AUDIT-002 | artifact 最小集合；独立审阅可重建确认 Action 与终止分类 |
| R-041 | T-EFFECT-001 至 T-EFFECT-006 | intent/receipt/Turn commit 六个 crash side 的持久性与恢复 |
| R-043 | T-RECOVERY-001、T-RECOVERY-002 | 同实例/anchor才继续；禁止 Action-log rebuild |
| R-044 | T-SAFE-REPLAY-001、T-NOTE-001 | 只读 replay；替换写用 invocation + anchor 防覆盖 |
| R-045 | T-RESET-002、T-RESET-003 | retry_state pending/activate；boundary重复交付不重复 RESET |
| R-046 | T-CHECKPOINT-002、T-CHECKPOINT-003 | partial无效；完整 marker；delivery replay不改 Game |
| R-047 | T-SIDECAR-001 至 T-SIDECAR-004 | instance ID、actionId去重、disconnect、pending Action查询 |
| R-048 | T-TERMINAL-001、T-LATE-001 | terminal不可改写；迟到结果只追加 Evidence |
| R-049 | T-PI-BOUNDARY-001、S-BOUNDARY-003 | Pi durable state不能替代 Environment/Turn Evidence |
| R-050 | T-TOOL-ORDER-001、T-TOOL-ORDER-002 | sequential；同 response 仅首个 `play` 可执行 |
| R-055 | T-OFFLINE-001、T-NETWORK-001、T-SECRET-002 | faux model/fake Environment；真实网络和凭据访问必失败 |
| R-056 | S-COVERAGE-001、T-FAULT-MATRIX-001 | TS 90/85、Python 90/85；所有故障矩阵行都有测试 |
| R-057 | S-BOUNDARY-004、T-BOUNDARY-CHECK-001 | import boundary check及其违规 fixture自测试 |
| R-058 | S-ASSET-002、S-GENERATED-001 | 显式 include/exclude；fixtures保留；生成 drift失败 |
| R-059 | S-CI-001、M-BRANCH-001 | 八个稳定 required check 名及 branch protection |
| R-060 | S-TRACE-001、M-ROUND5-001 | 每个 MUST/禁止项有映射；高风险项至少一个自动测试 |

## 3. 第 3 轮故障矩阵覆盖

| 故障位置 | 验证 ID |
| --- | --- |
| 模型 request intent 前/后 | T-MODEL-FAIL-001、T-MODEL-FAIL-002 |
| safe 工具 effect pending | T-SAFE-REPLAY-001 |
| `play` intent 前 | T-EFFECT-001 |
| Action intent 后但未接受 | T-EFFECT-002 |
| Environment 执行中/receipt不可查 | T-UNKNOWN-001 |
| receipt 完成、Turn commit 前 | T-EFFECT-003 |
| Turn commit 后、Pi settlement 前 | T-EFFECT-004 |
| RESET commit/boundary delivery | T-RESET-003 |
| checkpoint partial/complete/delivery | T-CHECKPOINT-002、T-CHECKPOINT-003 |
| sidecar disconnect，有/无 pending Action | T-SIDECAR-003、T-SIDECAR-004 |
| Raw Frame 缺失/损坏 | T-EVIDENCE-001、T-EVIDENCE-002 |
| 用户取消，有/无 pending Action | T-CANCEL-001、T-CANCEL-002 |
| storage fault，有/无 pending Action | T-STORAGE-001、T-STORAGE-002 |
| terminal 后迟到结果 | T-LATE-001 |

## 4. 第 5 轮新增 contract 验证

| 验证 ID | 覆盖要求 | 验收重点 |
| --- | --- | --- |
| T-JSON-CANONICAL-001 | R-038、R-040、R-055 | TS/Python 对固定 Unicode/key-order/newline test vector 产生完全相同 canonical bytes 与 SHA-256 |
| T-SCHEMA-CORPUS-001 | R-036、R-038、R-040、R-055 | CLI/tool/artifact/sidecar schema 在 TS/Python 两端对同一 valid/invalid corpus 结论一致 |
| S-RUNTIME-PINS-001 | R-011–R-013、R-052 | Pi/`pi-ai`、ARC Python runtime 与质量工具 direct pins/lock 一致；Pico3/VISTA/旧项目不是 dependency |
| T-CLI-CONTRACT-001 | R-033、R-039、R-040 | 只存在 `run`/`resume`/`audit`；required/unknown flag、full Game ID 和 empty artifact root 场景 |
| T-CLI-EVENT-001 | R-033、R-038 | JSONL envelope、连续 sequence、stdout/stderr 隔离、唯一 final event 和 secret 脱敏 |
| T-CLI-EXIT-001 | R-030、R-033、R-048 | 0/2/3/10/20/30 与 WIN、启动拒绝、已知失败、Unknown Outcome、audit failure 精确映射 |
| T-SDK-CONTRACT-001 | R-010、R-034、R-035 | 根导出、Run/Resume/Audit/Event 能力；无私有 Pi 类型、raw key、direct tool driving 或 callback |
| T-GAME-RESOLVER-001 | R-026、R-039 | full versioned ID、online cache miss、game-offline hit/miss、旧项目无 fallback |
| T-GAME-DIGEST-001 | R-026、R-039、R-058 | canonical manifest/tree SHA-256、symlink/path traversal/unlisted file/digest mismatch 拒绝 |
| T-ARTIFACT-SCHEMA-001 | R-038、R-041、R-048 | 八个稳定入口、schema major、Raw Frame/Visual 来源、terminal write-once 和可重建 audit |
| T-LEDGER-CHAIN-001 | R-038、R-041、R-048 | sequence/previousDigest/digest test vector、删除/重排/改写检测、late Evidence 追加 |
| T-SIDECAR-CONTRACT-001 | R-009、R-041、R-047 | open/anchor/submit/lookup/close 双端 accept/reject 与 version mismatch |
| T-SIDECAR-RECEIPT-001 | R-042、R-043、R-047 | not_accepted/pending/complete、重复 actionId、参数冲突和完整 Observation/Frames |
| T-SIDECAR-CONTAINMENT-001 | R-035、R-047、R-058 | game code 只在 sidecar 加载；SDK offline、无 provider secret/proxy/network client、无 Pi session/artifact root；cache content 只读 |
| M-ADR-001 | R-011–R-013 | ADR 0002/0003 与 accepted 规范、Pi 基线及 production dependency 一致 |

## 5. Implementation handoff 条件

Implementation handoff 必须将每个验证 ID 归入首批或后续 work package，并为首批实现范围内的 ID 给出精确命令。任何未分配验证、只有人工审阅的高风险语义或无法构造离线 fixture 的要求都不得进入实现。
