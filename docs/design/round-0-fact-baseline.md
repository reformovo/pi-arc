# 第 0 轮事实基线

> 状态：设计证据，不是实现契约。采集时间为 2026-09-20（Asia/Shanghai）。本文件只记录本地工作区事实，不代表接受任何实现方案。

## 1. 本轮范围

本轮只做只读检查并建立来源定位：

- Pi 当前代码、公开 package 边界与稳定/实验 runtime 状态；
- VISTA 当前工作树中与 Codex 路径相关的行为证据；
- 冻结 ARC 游戏及旧项目的可恢复性；
- `memo-docs` 的历史决策与当前工作树状态；
- 已确认需求与证据来源的第一版追踪关系。

本轮没有运行真实模型，没有改动来源项目，没有迁移数据，也没有删除文件。

## 2. 证据类别

| 类别 | 含义 | 本轮处理方式 |
| --- | --- | --- |
| 当前实现事实 | 当前本地代码或 package manifest 直接表达的行为 | 记录 commit、工作树状态和文件 SHA-256 |
| 历史文档 | 已完成实验、旧协议和当时结论 | 只作为历史语境，不自动成为新规范 |
| 设计证据 | 对候选技术、行为或取舍的分析 | 可供后续评审引用，但不是实现契约 |
| 尚未实现的提案 | 文档、聊天或源码注释中的未来方向 | 标为 open/gated，不宣称已经可用 |

## 3. Pi 基线

### 3.1 仓库定位

- 路径：`/Users/kaikai/projects/pi`
- 分支：`main`
- HEAD：`d1230ea2000d876b479a69b8b061f9d670f262f5`
- 描述：`v0.86.0-2-gd1230ea20`
- 提交时间：`2026-09-20T01:40:27+02:00`
- 工作树：干净，与 `origin/main` 对齐
- `@earendil-works/pi-agent-core`：`0.86.0`
- `@earendil-works/pi-ai`：`0.86.0`

### 3.2 当前事实

- 稳定 `AgentHarness`、lane API 和 session API 从 `@earendil-works/pi-agent-core` 根导出。
- JSONL session repository 是公开稳定 surface。
- lane 级 `watch()` 已实现；session 级 `watchSession()` 在当前实现中仍抛出 `SliceNotImplemented`。
- 稳定工具协议支持 `replay: "never" | "safe"`、durable invocation identity 和 memo。
- Pico3 通过 `@earendil-works/pi-agent-core/experimental/pico3` 单独导出，入口名称明确标记 experimental。
- 官方 `micro` 使用 Pico3，但 coding-agent 发布清单排除了 experimental 目录，因此不能把仓库内 `micro` 模型适配器当作已发布公共 API。
- 本地 `node_modules` 尚未包含 0.86 引入的 `@earendil-works/chord`，所以本轮没有把源码中的测试矩阵误报为本地已通过测试；正式可行性验证需要先按锁文件建立干净依赖环境。

### 3.3 关键文件哈希

| 文件 | SHA-256 |
| --- | --- |
| `packages/agent/src/harness/agent-harness.ts` | `f00e89cdf1412e4193db0207c9358d89116e240fba1823c9db81eb6e8f1f85f5` |
| `packages/agent/src/harness/runtime/harness.ts` | `0d92dcd8802e5de32d15f6aa2650c349c0df3c9da206449959941594d9e69b05` |
| `packages/agent/src/harness/session/jsonl/repo.ts` | `b0370397238b0ebbb8ff5ac9cceb0a3c22ded3e381f8462b7aff8e41de952a49` |
| `packages/agent/src/harness/pico3/index.ts` | `ed16bfba0f151b0cfde690dc49c94a3af6719c55dd8fdea3ff8c1b9fb26a1462` |
| `packages/coding-agent/src/experimental/micro/runtime.ts` | `0e77b46306e73967fef27600ff3f3e340025824d9e8d526c50e98c9577b0c729` |
| `packages/agent/docs/harness.md` | `8bb08ad97dcd0227a16a7ec29a563fd7c2ed7b64d474d89d9b53f4c61a053b1a` |
| `packages/agent/docs/pico/pico-simple-blockers.md` | `b93d7431920cf2cb29caaa2a45947f1b090a58edecb02e31863fc9d0b85339d0` |
| `packages/agent/docs/pico/pico-simple-handoff.md` | `973301b317788955992d92833a32738b4a20190908eaa3bab20c31fd1caca8f5` |
| `packages/agent/docs/work-packages/09-lane-snapshot-settled-tools.md` | `fa342633e58f87cfcbde876920f555c0e250b788429a94d4da898f7123ba3a43` |
| `packages/agent/docs/mobile-handoff/README.md` | `45ae30da0f72f3487e97bc32ae0c962d36f98d2ceb862c0b656266c2f6f24762` |
| `packages/agent/docs/mobile-handoff/01-harness/02-scopes/implementation-handoff.md` | `71846ba3845bd2f994fba6935f28e3cd3bfa5ee3f26f142956f9d044e06936c5` |

Pi 的规范、设计证据、implementation handoff 和 work package 分层方式另见 [Pi 开发模式证据](pi-development-pattern.md)。

## 4. VISTA 基线

### 4.1 仓库定位

- 路径：`/Users/kaikai/projects/memo/VISTA`
- 分支：`test/glm`
- HEAD：`63c8843822cb371bb52a59f0cee18c4020f2494b`
- 提交：`test: codex`
- 提交时间：`2026-09-20T18:45:56+08:00`
- 工作树：干净。

第 0 轮最初采集时，VISTA 位于 `0b1ec326f7a80ce778806033462c860c1300f1df` 且工作树为 dirty。用户随后将这些变更提交为 `63c8843822cb371bb52a59f0cee18c4020f2494b`；关键行为文件内容与已记录哈希一致。后续设计以新提交和文件哈希共同定位证据，不再依赖未提交工作树。

### 4.2 当前可观察证据

- Codex 工具契约包含 `play`、`history`、`inspect`、`read_pixels`、GUIDE/WORKING 读写和显式 `save_compact_checkpoint`。
- Codex RESET 要求 `retry_state`，并形成新的恢复边界。
- 当前 Codex controller 的显示坐标为 1024×1024，ACTION6 映射到 64×64 环境坐标。
- controller 区分权威环境观察、模型笔记和恢复信封，并保存动作、帧、恢复与错误记录。
- `play` 被视为非幂等外部效果；共享 HTTP 适配明确禁止可能已经发出的动作因 read timeout 自动重放。
- harness 对 checkpoint、RESET 和 runtime failure 有独立恢复路径；这些路径是新规范的行为证据，不自动决定 `pi-arc` 的内部结构。

### 4.3 关键文件哈希

| 文件 | SHA-256 |
| --- | --- |
| `src/vista_arc3/codex/prompt.md` | `cc857eef6d694946ba70b01e9070980705308d9e53f3373487722614d30dc120` |
| `src/vista_arc3/codex/tools.py` | `6d007c355b74c354a8db7bb4381133ffdd5f6e3cd2baf2660a3de46bf62c687e` |
| `src/vista_arc3/codex/controller.py` | `388c0cce57184e9cc5ef98f2032f808481bbebfdf251f1fafb7052b53a309994` |
| `src/vista_arc3/codex/dispatcher.py` | `22baeec3071ada9a9fdeff2623fe76167ce3c0abf308430190f457bd2312e660` |
| `src/vista_arc3/codex/recovery.py` | `e30c656e8cb3f14fe2d7e36cb1dd423482e647d9207f8bbf8ab168d9c6192a3d` |
| `src/vista_arc3/codex/harness.py` | `7eab4d41924ed322ac38a029c9d4e12d0dad6266f1f9e6218e8d6779f22dc69b` |
| `src/vista_arc3/codex/runner.py` | `71a6d34f8dd271eb0d6a59faa91fa329ddb06b2e27ccfd1f23ef2649dfa36759` |
| `src/vista_arc3/shared/render.py` | `5fa0bade5c3b04ffdbf0528f7ac829a84d284085c994092b57a3b98c9b927f5e` |
| `src/vista_arc3/shared/http.py` | `f6483742d5a3ce3854267c7b11adf3d8442031ec2cbc1f6189ca29dfe330b05e` |
| `pyproject.toml` | `9f8946863b55906a78544bef774d2eb3d5f5e57a167c2dd6238170d4323e6377` |

## 5. `memo-arc` 中的旧游戏数据

- 路径：`/Users/kaikai/projects/memo/memo-arc`
- Git：`main`，仓库尚无任何 commit；全部项目文件均为 untracked。
- 当前目录约 492 MiB；冻结 `data/` 约 112 KiB，游戏文件约 108 KiB。
- manifest schema：`memo-arc-game-v1`
- 游戏：`ls20-9607627b`
- 固定 seed：42（manifest 中的准备记录）
- 固定依赖：`arc-agi 0.9.9`、`arcengine 0.9.3`、`pillow 12.1.1`
- 当前 Pi 依赖仍为 coding-agent `0.85.1`，不能作为新 runtime 版本依据。

| 文件 | SHA-256 |
| --- | --- |
| `data/manifest.json` | `33652e4c09d34da50e2ee16bd6974b3d314f4589de0b0cf4ca68f0b290aa8775` |
| `data/environments/ls20/9607627b/ls20.py` | `298c810da2850d557c95d92a2cbd846df29a45d7134e20888617bedf5dafcd92` |
| `data/environments/ls20/9607627b/metadata.json` | `f78c79393e6e6eb6e715e691f86b48f65c4b4d99d00559d8fe24160cbe184c03` |
| `arc_env.py` | `d3ff33fe1f469320462012aa76af5eb0ede6fe17b94defaa587c91c0ecb5d2de` |
| `agent.ts` | `7f7ef0dbf42b277717cc0003380814f5b1e39843f4bfa9d5eabd3fac002efbe9` |
| `run.py` | `aa60214e71c046b2c0004fffed7b57146effc3cb6794fd15aabe3fb65eb69314` |
| `package-lock.json` | `88f1e117e96ee69bd321de84542797bc8f49158a477a188e0226e3136690043d` |
| `uv.lock` | `73b15b8a6a21053f5e7568e5cd63e33180f497a86c3b46d0ee67ebe01ea1e7b0` |

以上游戏文件与 manifest 哈希一致，只构成旧项目的事实证据，不是 `pi-arc` 的迁移来源。用户已明确要求新项目通过统一的数据获取流程重新拉取 game 数据集，不复制这些文件。

## 6. 其他待退役项目

| 项目 | Git 状态 | 当前规模 | 关键版本事实 | 风险 |
| --- | --- | ---: | --- | --- |
| `memo` | `main`，无 commit，全部文件 untracked | 约 2.2 GiB | coding-agent `0.85.1`；Python 3.11/ALFWorld | 删除后源码、运行材料和环境均无法从 Git 恢复 |
| `pi-memo` | `main`，无 commit，全部文件 untracked | 约 185 MiB | package `0.12.0`；coding-agent dev dependency `0.85.1` | 删除后 package 与测试无法从 Git 恢复 |

`pi-memo` 的归档和历史工具是研究历史证据，但用户已经要求新 v1 不继续其跨运行经验路线。此判断仍需在新规范的目标/非目标章节中正式表达。

## 7. `memo-docs` 基线

- 路径：`/Users/kaikai/projects/memo/memo-docs`
- 分支：`main`
- HEAD：`16a0324ec34aa23017a6c13490b440e84404e019`
- 工作树：dirty，包含用户已修改的 `CONTEXT.md`、README、最小闭环和论文，以及大量未跟踪历史实验文档。
- 已有 ADR 0001/0002 仍描述 `memo`、`pi-memo` 的旧职责与命名；在退役决策正式接受前不修改或 supersede。
- VISTA 验证与分析文档属于历史证据，不是 `pi-arc` 实现规范。

## 8. 不可逆风险与保护措施

1. 三个旧项目均无 commit，删除是不可逆的数据销毁；设计阶段必须保持只读。
2. VISTA 参考实现已提交且工作树干净；后续引用仍记录文件哈希，以便发现提交内文件发生漂移。
3. 新项目不得把旧游戏文件当作供应来源；统一拉取流程在进入实现前仍需明确权威来源、固定版本、缓存和完整性校验规则。
4. Pi runtime 可行性不能仅由类型表面推断；在进入实现前需要干净依赖环境和 focused conformance 验证设计。
5. 历史实验结果不能证明新 runtime、笔记或 recovery 机制的独立收益。

## 9. 下一轮

第 1 轮只处理领域语言、目标、成功标准和系统边界。除非第 0 轮基线获得确认，否则不创建 `CONTEXT.md`、ADR 或新的规范行为章节。
