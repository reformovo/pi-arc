# 真实验证前候选源码/构建快照

状态：离线候选身份记录，不是released commit或真实Game验证。用户/GitHub主main基线为b89a371；本线程HEAD为00322c240bc5ad8e85b8e444f78cf25278e7ada0，含已回退的旧notes候选历史。**当前对齐改动仍未提交，dirty/untracked；HEAD本身不代表被测试源码。** 本记录不授权commit/merge/push/live。

## 快照算法与范围

以本线程项目根为相对路径，枚举指定目录的普通文件（拒绝非普通文件），排除`/__pycache__/`与`.pyc`，不包含.env/密钥、node_modules、.venv、Game cache、run-artifacts、coverage或VISTA。各文件记录`{path,size,sha256}`，按path升序排序，按此key顺序JSON.stringify后追加一个换行，计算UTF-8 SHA-256。不是Run artifact canonical JSON，不把两种digest规则混用。

source范围：src/、python/、schemas/、generated/、scripts/，以及package.json、package-lock.json、pyproject.toml、uv.lock、generated-manifest.json、tsconfig.json、tsconfig.build.json、biome.json、.nvmrc、.python-version。单独记录tests/和build dist/，文档不进入source digest。build是本次完整check后显式npm run build产物。快照不锁定未来编辑；任何源码/测试/构建变化都必须重算，不能沿用摘要。

| 范围 | 文件数 | SHA-256 |
| --- | --- | --- |
| source/config | 95 | 23f6991de574ad0f0cd3ef85179c894a75df0228ae26fbce7018fdd7eef5485c |
| dist build | 62 | 5fc7927be6ad8b126e387cdf544296b436d11630e9a1c68cdcd9705fd00a9302 |
| tests | 60 | 461b280b64975136f3538ec9118d1cf562afde21737c4fad717870a98e296862 |
| 实际组合system prompt | — | 01119261eabc022587dc589683695ee731bf30c987456886a03757556912ad3c |
| MODEL_TOOL_DEFINITIONS（JSON.stringify+换行） | — | c97c809393917af769041ff8886c9f05b764ecd6c4efbaef914fc2688223e988 |
| package-lock.json原bytes | — | 8a48d327c23b4091bf983c1002de3237c94f1ef9c296038961acf6c2944934a6 |
| uv.lock原bytes | — | 7ac36352197d4d63ae6ef12242776fb2115a474ef0205a3d71686875a11e83c7 |

TASK/system资产、MODEL_TOOL_DEFINITIONS、schema/生成schema、依赖lockfiles相对b89a371无diff。VISTA主对照固定63c8843822cb371bb52a59f0cee18c4020f2494b，哈希见P1矩阵；不混用当前VISTA HEAD。

## 新增实际消息闭环

cli-sdk新增faux ACTION6集成测试：第一次play(408,120)提交native(25,7)；随后history(1..1)实际传到provider的动作是带visual_1024/canonical_replay_equivalent标签的(408,120)；faux基于收到字段发起一个**新的**play，两次intent和sidecar receipt都为native(25,7)，actionId不同。预算2正确终止、audit通过。不是自动重放已提交动作，不宣称fake Game真的有该格机关（fixture不解释coords）；这是传输/parser/authority记录闭环。

Node22.23.1/npm10.9.8/uv0.8.12/Python3.12.9完整npm run check、npm run build、git diff --check通过：TS323/Python33/contract双端各4/integration86；跨gate有重叠。TS statements90.63%/branches86.55%/functions95.69%/lines93.96%，Python lines93.98%/branches90.00%。旧独立review为静态approve-with-limits，本轮只增加测试和文档，未重新请求独立review。

## 发布/运行前暂停点

推荐用户另行授权提交本线程已审阅改动，形成清晰commit，再重算候选身份、确认dirty为空并build；用户主main和GitHub不在本轮自动移动。若用户选择直接验证未提交候选，应以本快照树摘要而非HEAD归属记录，并在开始/结束确认源码未变。真实provider、Game加载/重放/下载和费用需按单独计划明确授权；目前均未执行。
