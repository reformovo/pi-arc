# 已执行 Game 轨迹分析：合并基线前证据

状态：离线只读分析，非 accepted 规范，不修改 TASK/system prompt，不启动真实 Game。

## 结论先行

现有 artifacts 无法严格证明 cd82/FT09 使用的源码树等同 `b89a371`：manifest 没有记录 source commit/tree identity。运行在提交前发生不证明代码不同，因为可能使用了后来提交的工作树代码。因此精确版本归属是 unknown，而不是已证实不匹配。它们仍可作为行为和模型探索轨迹证据，但不能单独构成精确提交的可复现性验收。

因此本轮不重跑 Game：当前目标是分析笔记/恢复语义，不是宣称新 baseline 的真实收益。若以后需要验证 b89a371 本身，必须另行授权并在 manifest 增加或外部锁定 commit、依赖、prompt digest、Game digest、provider/model/revision、seed、budget。

## 版本与运行事实

| Run | 时间/配置 | 结果 | 可确认内容 | 不可确认内容 |
| --- | --- | --- | --- | --- |
| cd82 原始官方运行 | 2026-10-10；cd82-fb555c5d；deepseek/deepseek-flash/max；seed 42；cache digest `883bc…c25d66` | 被 RESET bug/人工停止，不是 WIN | 官方渠道、Game/model/runtime/坐标元数据 | 是否包含 2026-10-12 的修复 |
| cd82 resetfix | 2026-10-10；同 Game/model/seed/budget；game-offline | 121 Action、WIN、6/6、audit=true | 修复后新局正常通关和审计；本局无 RESET | 是否等于 b89a371 构建 |
| FT09 | 2026-10-10；ft09-0d8bbf25；deepseek/deepseek-flash/max；seed 42；Game digest `7a436…51063f` | 227 Action、含一次 RESET、WIN、6/6、audit=true | 长探索、RESET 后恢复、作者笔记行为 | 是否等于 b89a371 构建 |

manifest 确认了 `coordinates=1024`、Pi/AI `0.86.0`、Game digest 和模型身份；没有 `sourceCommit`/构建 digest，因此只能做行为归因，不能做提交归属证明。

## FT09 Level 5 时间线

- Turn 50 进入 Level 5；Turn 52 写入 `v161 GUIDE` 与 `v162 WORKING`。GUIDE 把共享格一致性和颜色映射写成 `EXACT/validated`，但覆盖仍是局部证据。
- Turn 53–70 执行 18-tile 方向的连续试验；Turn 70 失败。失败反驳了当时的完整解释，但没有立即形成结构化的起点/动作/观察/污染台账。
- Turn 70–98 继续候选切换；后续记录指出 Turn 98 试验受此前 M8 点击污染，不能作为干净起点的同等反证。
- Turn 98–178 继续重复/组合候选动作，部分重复是 parity 探索，部分无法仅凭笔记判定是否改变了假设；Turn 179 GAME_OVER。
- Turn 180 RESET 进入 Attempt 2。工程上产生了新 Turn/Attempt 和 fresh boundary，但旧 GUIDE 与新的 retry_state 语义没有完全对齐，恢复后花费约 14 分钟重新分析，期间无 Game Action。
- Turn 181/182 使用 `(33,7)`、`(33,7)` 造成已知 native/display double mapping；Turn 183 改用 visual1024 `(528,112)` 后产生有效变化。这是已修 harness 表达问题，不是新的笔记策略问题。
- Turn 183–213 执行修正后的候选计划；Turn 214 完成 Level 5，Turn 227 WIN。最终成功不能回溯证明 Turn 52 的规则总结一直正确。

## 责任分类

### 可归为模型作者笔记/探索语义的问题

1. 局部共享格一致性被升级为完整机制与 `EXACT` 规则。
2. 失败候选缺少可复查的起点、动作、观察和污染状态。
3. 候选计划在验证前被称为 `solution`，没有持续保留可证伪状态。
4. RESET 后旧 GUIDE 的失效结论没有与 retry_state 共同表达。
5. 当前状态/parity 不完整，导致无法可靠区分新证据、重复试验和状态污染。

这些问题不能由宿主推导游戏规则或自动改写笔记来修复；当前没有足够证据授权改提示词。

### 已由 harness 修复、不要重复归因的事项

- native64 权威记录与 visual1024 模型坐标的表达/恢复投影；
- GAME_OVER 后 RESET 不应依赖 `availableActions` 列表；
- RESET receipt、Attempt、fresh context 和继续执行的工程闭环。

### 仍属未知

- 若在确切 `b89a371` 上运行，模型是否仍会产生同样的过度自信和重复试验；
- 在保留既有 VISTA 任务提示的条件下，恢复信息形态差异是否影响这些行为；
- 更频繁笔记写入会减少恢复成本还是增加 token/工具成本；
- 现有 provider/revision 变化对长推理和探索策略的影响。

## 当前工程缺口

artifact manifest 没有 `sourceCommit` 或等价构建身份，导致真实结果无法严格归因到某个 Git baseline。这不是本轮通过重跑可以自动解决的提示词问题。未来若需要 baseline reproducibility，应先设计最小 provenance 字段/外部记录方案并审阅是否属于公开 schema；不得静默扩大 schema。

本分析不增加生产代码、不修改公开接口、不读取凭据、不复制 VISTA 资产或解法。
