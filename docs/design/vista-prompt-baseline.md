# VISTA 模型提示词复用基线

> 设计证据，不是实现契约。唯一行为规范仍是 `docs/pi-arc.md`；本文件解释 WP-07 如何落实“尽可能复用 VISTA 提示词，先追求效果和表现一致，再优化”。

## 固定来源

来源为 VISTA 提交 `63c8843822cb371bb52a59f0cee18c4020f2494b`：

| 来源 | SHA-256 | 模型可见内容 |
| --- | --- | --- |
| `src/vista_arc3/codex/prompt.md` | `cc857eef6d694946ba70b01e9070980705308d9e53f3373487722614d30dc120` | 系统任务提示 |
| `src/vista_arc3/codex/tools.py` | `6d007c355b74c354a8db7bb4381133ffdd5f6e3cd2baf2660a3de46bf62c687e` | 九个工具的 description、schema hint 和 annotation |
| `src/vista_arc3/codex/harness.py` | `7eab4d41924ed322ac38a029c9d4e12d0dad6266f1f9e6218e8d6779f22dc69b` | checkpoint 注入、继续任务与初始消息 |
| `src/vista_arc3/codex/recovery.py` | `e30c656e8cb3f14fe2d7e36cb1dd423482e647d9207f8bbf8ab168d9c6192a3d` | RESET/compaction 的恢复消息结构 |

VISTA 系统提示原文字节保存在 `src/application/prompts/prompt.md`；pi-arc 必需的两句补充要求单独保存在 `src/application/prompts/pi-arc-addendum.md`。`src/composition/prompt-loader.ts` 读取两份文件，`src/application/model-prompts.ts` 只负责纯文本组合以及 provider-neutral 工具描述/schema hint。VISTA 不成为运行时依赖，也不读取其工作区文件。源码注释、设计文档和评审记录继续使用中文；模型提示保持英文，是为了减少与已验证行为基线的无关差异。

## 保留与最小偏离

| 项目 | 处理 | 原因 |
| --- | --- | --- |
| 系统提示 | 完整 VISTA `prompt.md` 逐字保留，随后仅补两句“预测须可核对、Environment Observation 是权威” | 第 10.4 节要求可证伪预测；笔记与预测不能成为环境事实 |
| `inspect`、`read_pixels`、`read_guide`、`write_guide`、`read_working`、`save_compact_checkpoint` | description 与 VISTA 逐字一致 | 行为与规范兼容；测试固定原文 SHA-256 |
| `play` | 除 RESET 句外保持 VISTA 措辞、Action 提示、1024 坐标和 `retry_state` 提示 | VISTA 说 RESET 可初始化；pi-arc 的初始 Observation 来自 Run start，RESET 只在 GAME_OVER 后重试 |
| `history` | 只把“当前 Level”改成“本 Run 的多个 Level” | pi-arc history projection 包含跨 Level 的已提交 Turn |
| `write_working` | 只补 `via retry_state` | pi-arc RESET 成功后以 `retry_state` 替换活动 WORKING；直接声称原内容持续存在会误导模型 |
| checkpoint 注入、任务目标、非终止继续提示 | 保留 VISTA 英文原文 | 保留模型停止、保存和继续的既有节奏 |
| 初始/边界恢复消息 | 保留 VISTA 的标签、字段名、Environment 与 notes 分栏及目标句 | 具体 Observation/history/knowledge 值由后续 runtime adapter 从已提交 Evidence 提供 |

`GUIDE.md` 与 `WORKING.md` 在模型提示中保留为 VISTA 的逻辑名称；pi-arc 实际使用版本化知识快照，不向模型提供任意文件系统写权限。输入 JSON Schema 是给 provider 的形状提示，最终字段、条件限制和 Unicode code point 上限仍由 `ModelToolExecutor` 校验；不能把 schema hint 当作唯一安全边界。

schema hint 也只做契约所需的最小适配：VISTA 的 ACTION6 `x`/`y` 类型容许 `null`，pi-arc 只容许整数；VISTA 为 history Turn 号设定 `999999` 上限，pi-arc 规范没有该上限。ACTION6 的“必须同时有 x/y”、RESET 的“必须有 retry_state”和 4096 总像素样本等跨字段条件仍由工具执行器严格校验。

## 后续验证边界

- WP-07 的离线测试固定独立 `prompt.md` 的原文字节、checkpoint 文本以及六个完全复用的工具 description 哈希，并检查三个最小偏离与 schema hint。
- WP-08 必须调用 `loadModelSystemPrompt()`，并直接使用本包导出的 `MODEL_TOOL_DEFINITIONS` 和恢复消息构造器；若 Pi 0.86 的公开接口要求转换格式，只改传输形状，不静默改写模型可见措辞。打包/发布时必须把两个 Markdown 资产放在 loader 的相对路径，缺失时明确失败。
- 离线测试只能证明提示词等价与协议一致，不能证明模型成绩与 VISTA 相同。真正的效果/表现比较要在后续显式的同 Game、同模型配置、同预算评测中完成；评测结果出现前不声称已达到 VISTA 水平。
