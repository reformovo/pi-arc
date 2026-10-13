# VISTA 行为对齐实施方案

状态：待审阅的非规范实施方案。唯一行为规范为 accepted `docs/pi-arc.md`；本文不授权 schema/提示词变更、真实调用、Game 下载、提交/推送或 WP-10。

## 目标与口径

目标是可核对的 **VISTA 行为边界对齐，并公开必要的有意差异**，不是同一模型必然产生相同动作或取得相同成绩。不把 WIN、缓存命中率或最终 GUIDE 当作对齐证明。

基线为用户/GitHub main 的 `b89a371`（含 `d15d09b`）。本线程新增笔记 addendum 已由 `00322c2` 回退，不恢复该策略，不强制每步写笔记，不让宿主推导规则或代写笔记。当前既有 VISTA prompt 以及规范所需的两句 pi-arc 补充保留；本计划不增删其文字。

已存在的来源锁定见 `vista-prompt-baseline.md`：VISTA `63c8843822cb371bb52a59f0cee18c4020f2494b`，prompt/tool/harness/recovery 文件哈希及最小偏离已有说明。后续 recovery 复核引用过另一目录布局，必须先核对对应 revision/路径，不混用不同版本形成“完全对齐”结论。VISTA 仅作只读源码参考，不读取其游戏资产、具体解法或通关 GUIDE。

## 证据更正

真实运行早于提交不代表未运行该提交所包含的工作树代码。现有 manifest 缺 source commit/tree identity，因此精确源码归属未证实，而不是已证实不同。不能只凭日期决定是否重跑。

cd82 121 Action 成功局没有 RESET；FT09 227 Action 局才提供 GAME_OVER→RESET→fresh→继续→WIN 的真实路径。两者均早于最终 recovery 坐标表达修复，不能当作修复后整局恢复验收。单次坐标 probe 仅验证受控契约。

## 实施顺序与暂停点

### P1：固定可比较输入并完成差异矩阵

工作：
- 检查适用 AGENT.md/AGENTS.md；核验 pi-arc 源码与 b89a371 的差异，隔离分析文档与 runtime 变更。
- 只读核验 VISTA 固定提交是否含既有文档指定路径；对后续使用的 ARC3 Codex controller 路径建立 revision 对应表。无法定位时标 unknown，不自行选新版本。
- 从既有 prompt/hash tests 出发核验实际 loader、工具定义、runtime 注入路径，比较真实构造出来的模型可见内容，而不只比较源文件。
- 为 system/task、九个工具 descriptions/schema hints/results、初始消息、普通 play、history、GAME_OVER/RESET、Level、checkpoint、进程恢复、nonterminal continuation 建立一行一项矩阵。

每行包括：VISTA revision/文件/行号、pi-arc 文件/行号、差异、规范依据、对应测试、结论和未验证项。状态固定为 equivalent / intentional divergence / defect / unknown；文本字节相同、结构相同、语义等价必须分别标注。

交付：中文 `docs/reviews/` 对齐矩阵及可复查的 digest/定位；不复制 VISTA 实现为依赖，不嵌入游戏解法。

P1 验收：所有列出的 surface 都有结论或明确 unknown；既有两句 addendum、RESET 初始化限制、跨 Level history、retry_state、schema hint 最小适配均可追溯。先向用户报告矩阵，尚不实施行为变化。

### P2：关键恢复场景离线对照与轨迹归因

使用 committed fake Environment + faux Models，不加载真实 Game；复用现有 fixtures/proofjoin tests。

| 场景 | 必须核对的模型可见行为 |
| --- | --- |
| 初始上下文 | 任务原文、工具定义、当前 Observation、Visual 和 notes 分栏 |
| 普通 play/拒绝 | 单 play 后先观察；已提交结果；拒绝不造 Turn/Attempt |
| GAME_OVER→RESET | retry_state pending/committed 区分，新 Attempt、同 Level、fresh context、不重复 RESET |
| Level 切换 | GUIDE 延续；旧 WORKING 归档并移出活动状态；history 不混淆 Level/Attempt |
| checkpoint | gate 内仅 checkpoint 工具；完整 GUIDE/null 与 WORKING 原子引用；新上下文但游戏状态不变 |
| 未结算 Action 恢复 | 先核对 intent/receipt/commit；先交付最后结果；不重发已提交 Action |
| 截断 history/多 Attempt | 明确实际范围和 truncation；旧 Attempt 不冒充当前状态 |

坐标沿用已修规则：权威 native64 不变，模型恢复 ACTION6 为 visual1024 canonical_replay_equivalent 中心；不是原始输入，不除16、不重放。

FT09 轨迹只读核对 notes 写入参数、commit version、恢复正文和后续模型动作。分别判定：信息缺失、表达差异、作者语义不足、unknown。宿主只能核对版本/锚点/完整性；GUIDE 与 retry_state 的游戏规则矛盾不能被自动裁定为工程证据冲突，不能因此拒绝恢复或替换笔记。

交付：关键场景预期/实际比较和 FT09 证据表。只能描述已观察错误；重复坐标不自动算重复失败试验，起点/parity 不明时标 unknown。保留事实、假设、反证、污染状态的人工 rubric，不把它变成模型模板。

P2 验收：所有高风险恢复场景有 fixture/既有测试或明确缺证据；可说明哪些内容在 fresh context 实际交付。历史成功记录与当前代码回归分开陈述。

### P3：按矩阵决定最小修复或规范议题

分流规则：
1. accepted 规范要求的信息缺失或错误接线：提出最小 harness patch，只修投影/关联/交付，不改提示词或工具描述。
2. 现有实现与规范一致、但与 VISTA 不同：记录 intentional divergence，不直接实现 VISTA 行为。
3. 行为/提示词/schema 必须改变才可对齐：给出精确 diff、规范影响和保守替代，暂停等待用户审阅。
4. 作者笔记已被完整交付但推理错误：归为模型探索问题，不增加宿主求解逻辑或隐式指令。

重点议题是 VISTA per-Attempt summary 与 pi-arc 有界当前 Level committed history：先比较信息损失及128条截断边界。默认保留 accepted history 工具与恢复形态；需要 summary 时单独评审规范/设计，不静默改变数组或公开 schema。

P3 验收：每个 patch 必须对应明确 defect 和失败前/修复后测试；没有 defect 则不改 runtime。任何产品取舍先报用户，不能以“优化笔记”扩大实现范围。

### P4：只读 provenance 核对与离线门禁

先检查已有运行 metadata、session 中的任务原文、工具定义和恢复正文；只输出安全摘要/hash/证据定位，不输出凭据、认证头或完整 provider payload。不可建立 source tree 身份就保持 unknown。

后续真实运行的保守方案是外部独立验证记录，不修改现有 artifact：在运行前固定 source commit、tracked tree digest、dirty status、构建/依赖/toolchain、模型可见 prompt/tool digest、VISTA revision、Game digest/seed、provider/model、thinking/budget、运行后 artifact digest。provider revision 取不到则写 unknown，不宣称同后端。方案需用户审阅后才生成实际运行记录，不静默改 manifest schema。

门禁使用 Node22.23.1/npm10.9.8/uv0.8.12/Python3.12.9；新工作树既有诊断脚本依赖 dist 时先 build，最终执行完整 `npm run check`、`npm run build`、`git diff --check`。required checks 无真实网络和 provider，阈值不降低。

P4 验收：矩阵结论与测试对应；prompt/tool 描述无未经批准 diff；schema/依赖/公开入口无漂移；不把 faux 行为称作模型语义理解。

### P5：是否真实验证，单独决策

只有 P1–P4 完成、明确 live-only 缺口且用户另行授权才执行。默认不重跑整局，不为了缺 commit 字段直接付费。推荐先一个有限预算的恢复/坐标契约验证；正常 Game、diagnostic setup、模型驱动 Action 分开报告。若目标是精确 baseline 整局可复现性，再单独授权一局。

仅用官方 deepseek/deepseek-flash；OpenCode Go 暂停。凭据由用户提供，名称 OPENAI_BASE_URL/OPENAI_API_KEY，ARC_API_KEY 可选；不读/回显/修改 .env。固定预算与停止规则，不自动重试扩大样本。

记录恢复后请求/耗时、无效坐标、可核对的重复失败试验、反证更新、动作/读工具/output成本；不以笔记长度/次数替代质量。不声称单次优于 VISTA；跨 revision 只能描述结果，不能归因能力差异。

## 完成条件和允许的结论

- P1–P4 完成：可以按矩阵说“所列行为边界在固定版本下经离线核对，已知差异如下”；不得直接说全部对齐。
- 明确 live-only 项验证完成：可以说“该恢复契约的受控真实样本通过”，不能外推所有 Game。
- 仍有 intentional divergence：只能说“规范兼容的 VISTA 行为对齐，保留已列差异”，不能说逐字/逐结构一致。
- 未固定模型后端、未做受控重复实验：不宣称逐行为一致、成绩等同或优于 VISTA。

本方案推荐先执行 P1，并在矩阵完成后暂停审阅；后续实施不越过提示词、schema、真实费用或 Git 发布授权边界。
