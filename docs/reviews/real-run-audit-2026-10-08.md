# 真实运行与实现审计：2026-10-08

本文是审计记录，不是行为规范或实现授权。审计基线为 HEAD `6bfe23ea981da2a4894b47c97e5951ed28224e57` 加当前未提交的模型配置、stdout 隔离、Action 拒绝分类和图片预算修复。审计不读取 `.env`，不调用真实模型、不获取新 Game。不能声称穷尽所有可能缺陷。

## 范围与证据

- 成功 Run：`run-artifacts/cd82-20261008T051213Z`；Game `cd82-fb555c5d`，provider/model `opencode-go/deepseek-flash`，max，seed 42。
- terminal：WIN，Turn 134，6/6；重跑构建后 CLI audit exit 0、ok=true、findings=[]。
- 锁定 Node 22.23.1/npm 10.9.8/Python 3.12.9 下 `npm run check`、`npm run build`、`git diff --check` 通过：TS 131、Python unit 29、contract TS/Python 各4、integration 38；数量跨 gate 重叠，不相加。
- 离线 reproduction 使用公开 faux Models + committed sidecar fixture，临时 root 结束后清理；未改变业务实现。
- 独立审阅范围：生命周期/恢复；获取/隔离/存储；工具/知识/CLI。结论需主线程验证，不能把未复现推断当成缺陷。

## 已复现缺陷

### F-01 / P1：动作预算未在每个 Action admission 上执行

`src/composition/pi-arc-host.ts:399-419` 在调用 `runtime.prompt` 外检查 budget。但同一次 prompt 可运行整个模型/tool loop，`controllerPlayPort` 没有预算门禁。离线设置 actionBudget=1，faux 在连续两次 assistant response 分别调用 ACTION1、ACTION7；实际返回 WIN、lastCommittedTurn=2、audit=true。这是预算超限，不是模型性能差异。

修复方向：把预算检查放到每个 Action 的权威 admission，明确最后一个预算内 Action 达到 WIN 的优先级；增加跨同一 Pi operation 的预算测试。

### F-02 / P1：模型请求期间 SDK 取消未阻止新动作

`src/composition/pi-arc-host.ts:400-403` 只在外层循环检查 signal；runtime 使用 TODO_CONTEXT，未把请求 signal 接入 in-flight operation/admission。离线 faux response factory 先调用 AbortController.abort()，再返回 ACTION7；实际 signal.aborted=true，但仍返回 WIN、Turn1。取消后无 pending Action 却执行了新动作。

另一个探针：catalog.fetch 内 abort 后，仍建立 sidecar/Run，最终返回 cancelled/Turn0 而不是启动前拒绝。这是同一取消接线问题的启动窗口表现。

修复方向：建立同一个取消 admission gate，覆盖获取后/Run 前和模型/tool loop；不得简单杀死已接纳 Action 而丢失 Unknown Outcome 分类。

### F-03 / P2：audit 被无关模型配置阻断，CLI 同步初始化绕过错误协议

实际执行 `OPENAI_BASE_URL=not-a-url node dist/composition/cli.js audit --artifacts <成功Run>`，抛出 createCliModels 的同步异常，exit1、stdout 无 JSONL。`src/composition/cli.ts:212` 在进入 runCli/.then 之前无条件创建模型配置。audit 本应不依赖模型。

修复方向：按命令惰性创建模型配置，初始化错误也走稳定 JSONL/退出码，不输出配置原文。

### F-04 / P2：不支持的 thinking level 被接纳

规范15.4要求 level 被所选模型支持；`src/composition/pi-arc-host.ts:284-285` 仅检查 reasoning 布尔。离线 faux reasoner 显式 thinkingLevelMap medium=null、仅 low/high/max 支持；请求 medium 仍启动并返回 WIN。模型实际使用的 level 可能由 Pi clamp 改变，而 manifest 仍记录请求值。

修复方向：通过公开 getSupportedThinkingLevels 验证所有请求值，包括 off；禁止静默改变实验配置。

## 真实运行确认的性能/策略问题

### F-05 / P1改进：图片数量有界，活动上下文仍膨胀

172个assistant response；完整请求输入=input+cacheRead+cacheWrite，从2371增长到443985 tokens。累计输入48650166；reasoning333670/总output352418（94.7%）。thinking正文977332字符，assistant可见正文23443字符，工具正文121851字符。`visual-context.ts` 保留所有文字/thinking，只替换旧图片。本局没有save_compact_checkpoint；不能以通关证明长任务上下文管理充分。

### F-06 / P2改进：缓存生效但仍有大量非缓存输入

总input23964214、cacheRead24685952、cacheWrite0；加权命中50.74%。按前56/中57/后59请求：命中21.0%/45.1%/62.7%，平均完整输入113822/315393/411843。最后十次约72–74%命中，但仍约12万非缓存tokens/请求。

cacheWrite=0不是故障证据。滚动删除早期图片可能破坏稳定prefix，但没有wire capture/服务端诊断，不能证明每次miss原因。之前子代理中段cacheRead=81061的数字错误，正确为8106112，不采用“中段缓存崩溃”结论。

### F-07 / P2改进：知识沉淀与细粒度可观测性不足

实际tools：play134、read_pixels29、inspect8、read_guide1、write_working1；无write_guide/history/checkpoint；173调用、172response、无工具error、无重复参数只读调用。初次同时inspect/read_guide，其他response单工具；没有多play执行。每关21/16/41/16/18/22动作；最终画面相同的动作只有Turn7/10/39/56，不能直接定性无效（可能探测）。read_pixels41792样本，20次>=1000、最高3420，仍合法。

外层model.requested/responded只有一对，而真实172次请求只能从session还原。建议公开hook记录每次usage/图片数/时延，无正文/密钥；不把外层operation当HTTP请求。

### F-08 / P2风险：产物和全量ledger写入随任务增长

本局pi-session60941585字节、domain5201857、frames5091287（574文件）、visuals3747711（575文件）。ArtifactStore.appendDomain/appendRuntime读取已有全部记录，每次重写完整JSONL，存在随长度增长的累计I/O成本；本次audit含npm启动约1.34s，尚未证明性能瓶颈。需长运行基准，而不是从文件大直接判断卡顿。

## 安全/评测与尚未验证项

- 凭据曾经由共享工作树编辑通知进入线程；这是已发生的操作安全问题，需撤销轮换。Git ignore不能防止共享编辑同步。审计不读取或复述密钥，也不声称已完成轮换。
- 服务端deepseek-flash是历史alias，当前客户端复用V4.1元数据；没有服务端不可变revision，不能认定134对154代表同模型同条件下harness提升。endpoint未入manifest；比较还需游戏digest、SDK/engine、seed、视觉/工具配置、重复样本和实际账单。
- Node artifact atomicWrite只有writeFile+rename，没有file/parent fsync；能证明rename原子可见性，不等于掉电持久性。Python receipt有fsync。需明确承诺的crash模型并验证，不把进程kill测试当掉电测试。
- Python socket monkeypatch和env白名单不是OS sandbox；ADR0005接受官方Game信任，不能将其报告为抵抗恶意Game的隔离保证。
- 真Run未触发RESET/checkpoint/取消恢复；fixture通过不等于跨进程/生产故障矩阵已完成。Linux/其他平台、长时间stall、disk full、power loss和服务端限流尚未在本次真实实验验证。
- accepted规范172明确v1不公开timeout/provider retry/transport/cache retention；新增费用/时长预算需要产品/规范决策，不能偷偷扩展CLI。

## 建议处置顺序

1. 凭据轮换（用户操作），修复F-01/F-02并补权威admission回归。
2. 修复F-03/F-04，确保audit与模型解耦、运行配置真实可信。
3. 评审上下文预算/checkpoint策略、细粒度指标与稳定prefix实验。
4. 完成跨平台故障/资源基准与双端评测配置证据。

初次记录只完成审计。用户随后授权按建议顺序修复，以下为处置结果；不自动提交或开始WP-10。

## 2026-10-08 修复与组合验证

- F-01 已修复：ControllerPorts固定Run预算，在每个Action admission和complete receipt后的Turn检查；最后预算内WIN优先。faux连续ACTION1→ACTION7、budget1现在Turn1/action_budget_exhausted，恢复authority也执行同一规则。
- F-02 已修复：catalog/auth后及Run前取消拒绝；runtime通过公开lane.abort关闭effect gate，不使用已取消context打断authority写入。模型期间取消不执行新Action；已接纳complete/WIN/Unknown Outcome按证据分类。清理abort listener。
- F-03 已修复：CLI静态校验后惰性初始化；audit使用空Models，不解析OPENAI_BASE_URL。非法模型配置run/resume返回JSONL run.rejected/exit2；其他初始化失败exit3，不泄漏错误原文。编译后的真实CLI进程测试覆盖audit0/10/20/30、archive只读和无manifest拒绝。
- F-04 已修复：公开getSupportedThinkingLevels严格校验，包括off；medium=null拒绝为thinking_unsupported，不静默clamp。
- F-07 指标已接入：公开before_request/transform_context/after_response钩子，payload.phase=provider_request，记录usage、实际投影imageCount、durationMs、step/attempt、httpStatus（若提供）和stopReason。保留外层operation事件，不把两者混计。公开hook错误行为由Pi管理，不将诊断提升为Environment Evidence。
- F-08 窄持久化改进已完成：生产I/O file.write→file.sync→close→rename→parent.sync→close；所有错误传播。未修改ledger格式/锁或声称实测掉电安全，新建祖先目录同步仍为限制。
- F-05上下文策略随后经VISTA复核并获用户授权：撤回固定200k策略，normal=contextWindow-72000/checkpoint=contextWindow-32000；公开hooks安全暂停普通工具，旧Context保存ARC checkpoint，committed boundary导航根并携带当前最终图像/authority/笔记交付新Context；禁用绕过ARC checkpoint的原生compaction。阈值以完整input+cacheRead+cacheWrite计算，attach恢复attempt与容量，不清零逃避上限。
- F-06缓存定位验证了OpenCode session header未丢失，发现VISTA重复usage通知导致manifest汇总偏差，但纠正后缓存差距仍存在；具体服务端原因未确认，不改private request字段。详见../design/real-run-context-follow-up.md。
- checkpoint合并后主线程重跑全部check/build/diff通过：TS182、Python29、contract各4、integration67；statements90.03%、branches85.53%。无真实provider验证，恢复effect_pending跨阈值专项用例仍待补充。小窗口normal<16000明确抛错，不是0阈值无限checkpoint；审阅者关于72k窗口无限触发的推测不成立。

组合门禁：Node22.23.1/npm10.9.8/Python3.12.9，npm run check、npm run build、git diff --check全部通过。TS166、Python29、contract双端各4、integration51，数量跨gate重叠。coverage statements90.21%、branches85.35%、functions95.32%、lines93.65%。未调用真实模型或下载Game。

独立审阅去噪：stderr.resume进入flowing模式会消费丢弃流，不采纳“Critical未drain”结论；receipt.turn=baseTurn+1是双端协议和fixture验证的规则，不采纳“可能公式错”结论；缺.venv导致ENOENT属于审阅环境未准备，不作为业务缺陷。SDK自定义logger与官方Game信任边界需按实证讨论，不将任意恶意Game绕过Python monkeypatch称为已承诺的OS sandbox破坏。direct main()的fd隔离仅测试入口不同，生产明确以python -m启动，暂无生产缺陷复现。

