# 模型恢复上下文的 VISTA 对齐复核

本轮按用户要求先修坐标域，再复核边界交付，暂不修改VISTA任务prompt或笔记模板。比较ARC3 Codex benchmark实现而非不相关的generic nativeCompaction分支。

## 直接确认的差异

VISTA src/vista/benchmarks/arc3/codex/controller.py:415 将validation.parsed传入_public_event；553–570_public_event使用原模型1024 x/y。映射后的validation.data只送Environment，不泄露为模型应重复的坐标。pi-arc archives记录native64 intent/receipt，恢复此前直接投影nativeAction。这是可复现harness表达差异，优先修复而不是责备模型忽略systemprompt。

修复方向：权威archive保持native、proofjoin先完整验证，再将模型可见ACTION6投影至native*16+8的visual1024格中心，并标记coordinateSpace=visual_1024/coordinateRepresentation=canonical_replay_equivalent。该中心不是原始输入坐标（原始输入没保存在intent）；不能虚称精确恢复原始值。回投映射必须还原相同nativecell。RESET/普通非坐标Action不变化。

## 边界交付已对齐的核心

两者恢复都包含currentObservation/lastActionResult/当前任务history/guide/working/当前视觉，RESET或checkpoint后真正freshcontext；同一Environment/game进度保持。pi-arc用versionedcommit/receipt审计更严格，不靠模型笔记定状态。已完成回归验证缺失证据/不一致authority failclosed、pendingintent/partialnotes不能成为已完成动作/activeknowledge。

## 仍不应声称逐字/逐形相同

VISTA ARC3 _attempt_history(controller.py645–695)是完整当前Level perAttempt摘要（start/outcome/game_actions/end/progress）；pi-arc恢复种子为最后128个当前Level committed动作/Observation。两者信息形态不同：前者压缩概览，后者具体细节且可能截断早期失败。当前pi-arc history tool还有跨Level范围与不同limit语义，这是accepted规范既有偏离，不静默改publichistory。

最小改进是为recovery每条history和lastAction添加已提交level/attempt/attemptStatus标签，避免RESET前后记录混淆；不把阵列突然改为对象/新摘要，也不从模型notes猜trial结果。若希望完全VISTA摘要形态需另行规范/设计评审。

## 笔记结论

坐标歧义与attempt标签属于harness输入一致性；错误legend过度自信、GUIDE陈旧仍可能是模型摘要语义问题。先验证本轮表达修复，再决定轻量笔记模板，不立即改taskprompt、tool描述、每步写入频率或注入VISTA解法。最终VISTA GUIDE不能当其探索前已知真相。

## 状态

坐标与attempt标签修复已合并：主线程锁定Node22.23.1/npm10.9.8/Python3.12.9运行npm run check/build/git diff --check通过（TS266/Python33/contract各4/integration85）；之后再补一条真实ModelToolExecutor parser端到端回归，22个boundaryfocused用例/types通过。输入恢复(408,120)经过实际playparser映射回(25,7)，archive未修改，避免只测数学函数而未测工具接线。

模型可见last_action_result及current_level_history明确coordinateSpace=visual_1024/canonical_replay_equivalent和level/attempt/attemptStatus；recovery-only说明不除16、不重放已提交动作。TASK/systemprompt、tool schemas/description均未修改。没有改历史FT09 notes或启动新Game/provider；真实模型是否还误解坐标未验证，也没有实施笔记模板或强制写入。

剩余边界形态偏离：pi-arc bounded128具体history而VISTA perAttemptsummary，是已知设计差异，未偷偷替换数组契约；若后续需要完全摘要对齐，应先评审。
