# P1：VISTA 固定版本行为对齐矩阵

状态：本文保留P1时点矩阵，P1已获用户审阅。P2/P3后续现状见文末状态更新；历史矩阵中的unknown/暂停项不可当作当前状态。非规范文档。

## 基准与复查方式

pi-arc runtime/source 基准为 b89a371；本线程 54e4b83 已被00322c2完整回退。实际 `git diff b89a371 -- src tests scripts package.json` 为空。本轮只新增/维护分析文档。两个工作树未发现 AGENT.md/AGENTS.md。未读凭据或 VISTA 游戏资产/解法。

VISTA 主对照固定为 `63c8843822cb371bb52a59f0cee18c4020f2494b`（下称 V0），不是当前 HEAD。`git show V0:path` 读取 source；不 checkout、不执行 VISTA。四份源码 SHA-256 全部与 [既有基线](../design/vista-prompt-baseline.md) 相符：

| V0 路径（src/vista_arc3/codex/） | 实际 SHA-256 |
| --- | --- |
| prompt.md | cc857eef6d694946ba70b01e9070980705308d9e53f3373487722614d30dc120 |
| tools.py | 6d007c355b74c354a8db7bb4381133ffdd5f6e3cd2baf2660a3de46bf62c687e |
| harness.py | 7eab4d41924ed322ac38a029c9d4e12d0dad6266f1f9e6218e8d6779f22dc69b |
| recovery.py | e30c656e8cb3f14fe2d7e36cb1dd423482e647d9207f8bbf8ab168d9c6192a3d |
| controller.py（本轮补核） | 388c0cce57184e9cc5ef98f2032f808481bbebfdf251f1fafb7052b53a309994 |

当前 VISTA HEAD 为 `c97c354f0a8948256545a3e8850a1848f8e5b8c1`（V1），路径为 `src/vista/benchmarks/arc3/codex/`。prompt 哈希相同，但 tools/harness/recovery/controller 哈希分别为 c197e3b46e2d89c80cc2932caa4d641f1f7e0d240f162de53a20150befb68592 / f040a59f1b27a6c39f5f885686942d179500ea95acb13c45e26e03b0284efd7b / 03230b1640b872fd70b30f1873c184f2358f56fe040dfbf02ab04b5fd8b6b048 / ba86ed2162538abb3544824526c7250f25247bb5fa31e9c7fc31d75ddf5eabe2。不能仅当作目录重命名后声称全部相同。

此前 recovery 复核中 V1 controller 的 `_public_event`、`_attempt_history` 行号对应554、645；V0对应1063、1162。二者都有 public visual 坐标/per-Attempt summary，但本轮不将 V1 全部行为替换为新基准。是否升级对照版本需用户决定。

V0 定位链接：[tools](https://github.com/joshhhhhan/VISTA/blob/63c8843822cb371bb52a59f0cee18c4020f2494b/src/vista_arc3/codex/tools.py#L39)、[controller](https://github.com/joshhhhhan/VISTA/blob/63c8843822cb371bb52a59f0cee18c4020f2494b/src/vista_arc3/codex/controller.py#L399)、[harness](https://github.com/joshhhhhan/VISTA/blob/63c8843822cb371bb52a59f0cee18c4020f2494b/src/vista_arc3/codex/harness.py#L481)、[recovery](https://github.com/joshhhhhan/VISTA/blob/63c8843822cb371bb52a59f0cee18c4020f2494b/src/vista_arc3/codex/recovery.py#L21)。这些是源码定位链接，不代表已核实该历史对象公开可访问；本轮依据本地 Git 对象。

## 实际接线（非仅静态提示文件）

`pi-arc-host.ts:363–411` 调用 loader，把组合 systemPrompt 传给 PiArcRuntime.attach，同时提供 recovery bridge/boundary 与最终 Frame PNG；437 初始使用 buildInitialTaskPrompt。`pi-runtime.ts:287–290` 使用 adapter.tools/systemPrompt/sequential；`pi-tools.ts:75–90` 原样传 description/schema hints，play never、其他 safe；129–141 结果 envelope 作为文字和 PNG 返回。`runtime-knowledge.ts:134–153` 使用 Environment/notes 分栏构造器，并追加 recovery-only 坐标说明。

构建后的实际 loader 摘要：source=cc857e…dc120；既有两句 addendum=8879f092938c6ba9f845bb40c1fca63656b5aa3b583eef44172fe3130754f217；组合 system=01119261eabc022587dc589683695ee731bf30c987456886a03757556912ad3c。组合使用 trimEnd+空行，不声称完整 system 与 V0 字节相同。源码 prompt 9行保留的是 VISTA 原文，已经要求紧凑、可修订笔记；没有新增 notes-v1。

## 差异矩阵

equivalent 只指注明的文本或语义；intentional divergence 指可追溯的规范/宿主偏离，不等于用户已经批准所有新增设计；unknown 需要继续证据或产品决定。未找到新的已确证 defect；不以测试通过证明模型效果。

| Surface | V0 定位与行为 | pi-arc 定位与行为 | 结论／规范边界／证据 |
| --- | --- | --- | --- |
| System/task | prompt.md:1–9，harness:481–489 | prompts/prompt.md:1–9；model-prompts.ts:12–27 | 原始 prompt 字节 equivalent；完整 system intentional divergence（两句预测/Observation补充，§10.4/§9）；model-prompts test |
| 工具顺序 | tools:447–468 九工具 | model-prompts.ts:123–210；pi-tools.ts:75 | equivalent 顺序；annotations 保留在定义，但 Pi adapter 没有同名 annotation 字段传输，不声称 wire相同 |
| play description/schema | tools:39–108 RESET可初始化，x/y可null | model-prompts.ts:125–145 RESET限GAME_OVER、整数 | intentional divergence（§6.3/§10.4）；坐标/必填交叉规则由 executor执行 |
| inspect | tools:237起，无平滑archived视觉 | model-prompts.ts:147–155，model-tools.ts:inspect路径 | description字节 equivalent；字段/envelope包装不同，语义检查由 model-tools tests覆盖，不证明同PNG字节 |
| read_pixels | tools:305起，palette+rows，不解释 | model-prompts.ts:158–166 | description字节 equivalent；§10.4，像素/顺序测试 |
| history description/schema | tools:137–170 当前Level attempts，Turn最大999999 | model-prompts.ts:169–179 跨Level，无该Turn上限 | intentional divergence（§10.4已接受跨Run记录），不改公开schema |
| history events/default range | controller:1137–1159；无范围最新limit，有范围最早limit；public event含action/result(1063–1083) | model-tools.ts:478–518；默认从Turn0取最早limit；events只有actionId/Observation/标签，没有动作参数 | **unknown 对齐决策**：已确认非等价；不能归结为仅跨Level差异。§10.4要求Environment action records，具体字段是否不足需审阅；现有tests只证明当前逻辑，不证明VISTA等价 |
| history attempts limit | controller:1100–1115 limit作用于Attempt；1162–1216 start/outcome/actions/end/progress | model-tools.ts:520–544 先截Turn再聚合，first/last/status | **unknown 对齐决策**：limit语义与信息量不同，可能丢早期失败；需P2边界fixture，不能悄悄变shape |
| recovery history | controller:423–433 当前Level per-Attempt summary | runtime-knowledge.ts:103–122 当前Level最后128 commits | intentional design difference但影响unknown；无 recovery 截断标记，早期Attempt可能丢失；完整history tool可查询但不等同完整交付 |
| read/write GUIDE | tools:READ_GUIDE/WRITE_GUIDE | model-prompts.ts:181–189；knowledge-store.ts版本snapshot | descriptions字节 equivalent；持久化/返回version/anchor intentional divergence（§12.3），knowledge-store tests |
| read/write WORKING | tools:180–215 RESET持续；controller:985–1010 retry替换 | model-prompts.ts:190–197 加via retry_state；knowledge-store投影 | read字节 equivalent，write必要措辞偏离；内容完整替换/Level清理语义对应，§6.4/§12.6 |
| checkpoint tool/injection | tools:412–443；harness:71–78 | model-prompts.ts:20–21、199–209 | description及checkpoint指令字节 equivalent；§12.7 gate/atomic commit为pi-arc责任 |
| 初始Observation/Visual | harness:481–489；controller:314–320 metadata/image | host:399–407、437；buildInitialTaskPrompt | 段落标签/目标 equivalent；Observation字段不是VISTA metadata(progress/available_actions等)，initial image实际调用路径由runtime tests覆盖；不宣称结构一样 |
| 普通结果与拒绝 | controller:1573–1646 ok/metadata/image；1063 public result | model-tools.ts:267–280；pi-tools.ts:129–141 schema/result/PNG | intentional divergence（§10.4 logical fields、错误分类）；模型可见键名不同，不能逐结构对齐 |
| 先观察再动作 | tools:91–95；controller串行handle | runtime:289 sequential；pi-tools.ts:101 gate | equivalent目标；pi-arc拒绝同response play后的全部tools（§12.2）更严格，integration:1188 |
| GAME_OVER/RESET | controller:301–304、747–789；harness:554–620 fresh session | controller RESET生命周期；knowledge-store retry原子激活；runtime fresh导航 | equivalent领域目标，不同session/context机制；§12.6；knowledge-store:98/runtime:1703 tests；FT09旧真实路径不是最终修复后对齐证明 |
| RESET notes/provenance | recovery:31–44 WORKING={saved_at,content}；controller:423–433 | runtime-knowledge.ts:59–60、149–151 直接字符串，anchor/version内部保留 | **unknown 对齐决策**：saved_at未进入恢复正文；无note为空串而VISTA可null；不自动添加字段/PROMPT |
| RESET last action coords | controller:797–800、1063–1073 原始visual输入 | runtime-knowledge.ts:14–42 bin中心visual1024，附domain标签 | intentional divergence：回投native等价但不恢复原输入；proofjoin后投影、§10.5/§12.4；boundary:182 test |
| Level | controller:779–781、927–984 archive/clear | knowledge-store Level投影，tests:141 | equivalent保留GUIDE/归档清WORKING（§6.4）；不能把旧palette/解法当新Level事实 |
| checkpoint/fresh | harness:623–698 oldsession保存后新session | runtime:533–582、650–675 公共navigateTree fresh | equivalent流程目标；容量阈值、失败预算与Pi机制非同一实现；§12.7、integration checkpoint tests |
| runtime Recovery | recovery:47–63 轻量同session；100–134 fresh notes | runtime recovery inventory +完整ARC envelope | intentional divergence（§12.4权威校验），不混用generic native compaction；integration:1514、1554 |
| nonterminal continuation | harness:81–84原文，其他continuation带Observation | model-prompts.ts:22–23；runtime:591–615 一次continue一次fresh | 指令原文 equivalent；策略不逐行为相同（§12.5），integration:1473 |
| no-progress/image policy | V0 harness:77–80 loops；不同Codex transport | runtime checkpoint/16普通工具stage guard；Go-only64图cap | intentional host policy，非VISTA逐行为保证；官方不套Go64；精确VISTA容量实现位置未在本轮五文件范围内证明，unknown |

## 测试与验证范围

Node22.23.1/npm10.9.8：运行 npm run build；Vitest定向5文件96用例通过：model-prompts、model-tools、knowledge-store、runtime-knowledge-boundary、pi-runtime integration。包含原文hash、六个description hash、schema hints、notes/RESET/Level/checkpoint、坐标parser和fresh admission。运行compiled loader读取实际摘要，未发provider请求。

P1未重新运行完整 npm run check，因为没有代码修改；文档完成后运行 check:spec/git diff --check。无真实调用/游戏下载/commit/push。独立scout因服务overload失败，未产出报告；上述来源与矩阵由主线程核对，不宣称独立review批准。

## 暂停审阅：建议下一步

1. 保持V0为主基准；V1仅解释后续路径，除非用户批准升级。
2. P2优先构造 history 两种limit、默认最新/最早、恢复128截断，以及 retry notes saved_at 的对照fixture；先测信息缺口，不改工具/schema。
3. 是否需要改变 history结果或note provenance交付由用户审阅，不能仅凭VISTA源码直接实施。规则冲突仍是作者语义问题，不让宿主裁定。
4. 当前可声称prompt原文与六个description保留、关键生命周期有离线覆盖；**尚不能声称恢复内容/历史逐结构等价或整体逐行为对齐**。以上为P1当时审阅点。

## P2/P3 后续现状更新

| 项目 | 当前结论 | 后续证据 |
| --- | --- | --- |
| history默认范围 | 已修复，无范围取最新；显式范围从起点分页 | model-tools unit/完整gate |
| history Attempt limit | 已修复，完整范围聚合后按Attempt限制；跨Level仍为规范偏离 | P3第一批 |
| events动作缺失 | 已补只读action，Turn0/null、native→visual canonical center；不是VISTA原输入 | vista-history-action-projection.md；shared proofjoin；provider-visible fixture |
| recovery最近128动作截断 | 已改完整Level per-Attempt summary，最近128个Attempt且标总数/截断 | vista-recovery-attempt-summary.md；FT09只读projection、长记录测试 |
| notes saved_at/空值 | 尚保留字符串和空串，内部版本锚点完整；属于已披露未对齐形态 | P2实际notes逐字核对 |
| runtime/结果包装/两句规范补充 | 保留 intentional divergence，不追求Codex transport字节同一 | accepted规范与P1源码对照 |
| 完整调用链 | 已增加SDK/faux provider实收RESET摘要/Visual与history action断言 | cli-sdk integration |
| source/backend归属、真实效果 | unknown/live-only，不由离线gate代替 | P4 provenance设计；真实调用另行授权 |

这一更新不改变V0固定基准，不宣称所有未知关闭；具体模型可见结果的新增action和recovery数组→摘要对象均已明确记录。
