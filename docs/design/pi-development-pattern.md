# Pi 开发模式证据

> 状态：设计证据，不是实现契约。本文提炼当前 Pi 仓库的开发纪律，说明 `pi-arc` 采用哪些模式、拒绝机械复制哪些仓库特例。

## 1. 证据来源

| Pi 文档 | 本轮观察到的角色 | SHA-256 |
| --- | --- | --- |
| `packages/agent/docs/harness.md` | 稳定 AgentHarness 的规范来源 | `8bb08ad97dcd0227a16a7ec29a563fd7c2ed7b64d474d89d9b53f4c61a053b1a` |
| `packages/agent/docs/pico/pico-simple-blockers.md` | 指定唯一规范、当前 work package 和审批停止点 | `b93d7431920cf2cb29caaa2a45947f1b090a58edecb02e31863fc9d0b85339d0` |
| `packages/agent/docs/pico/pico-simple-handoff.md` | 单一规范、gated 能力、race matrix 和编号 work package | `973301b317788955992d92833a32738b4a20190908eaa3bab20c31fd1caca8f5` |
| `packages/agent/docs/work-packages/09-lane-snapshot-settled-tools.md` | 可执行 handoff 的基线、目标、非目标、精确验证和已知不处理项 | `fa342633e58f87cfcbde876920f555c0e250b788429a94d4da898f7123ba3a43` |
| `packages/agent/docs/mobile-handoff/README.md` | 区分 production、prototype、spec 和 actionable 状态 | `45ae30da0f72f3487e97bc32ae0c962d36f98d2ceb862c0b656266c2f6f24762` |
| `packages/agent/docs/mobile-handoff/01-harness/02-scopes/implementation-handoff.md` | 带前置条件、完成定义和显式停点的实现交接 | `71846ba3845bd2f994fba6935f28e3cd3bfa5ee3f26f142956f9d044e06936c5` |

## 2. `pi-arc` 采用的模式

### 唯一规范

一个主题只有一份 normative specification。其他设计笔记、原型和历史 handoff 必须标记其权威状态，不能让实现者自行选择看起来较新的说法。

### 明确状态

文档必须区分 `proposal`、`under-review`、`accepted`、设计证据、历史记录、actionable handoff 和 implemented。尚未构建的能力直接写“未实现”，不能用将来时伪装成当前行为。

### Gated 而不是猜测

接口或失败语义没有决定时，将对应能力留在 gated 区域。implementation handoff 不得补充规范没有回答的问题。

### 小型 work package

规范稳定后才拆包。每个 package 必须有前置条件、明确目标、非目标、覆盖的规范章节、focused tests、完成定义和用户审阅停止点；后续 package 只能消费已审定的前置包。

### 测试先表达失败

在实现行为前先写或迁移能够暴露错误的契约测试。测试说明它防止的具体失败，尤其覆盖不会抛异常但会产生错误状态的路径。

### 基线与冲突处理

handoff 必须记录仓库、分支、commit、工作树前提和需要完整阅读的材料。实现发现规范与现实冲突时停止并回到设计，不在代码中静默选择。实现落地后若文档与已验证代码不一致，必须显式决定修代码还是修规范。

### 精确而有限的验证

每个 package 先运行 focused validation，再运行项目规定的统一门禁。真实凭据、付费服务或过宽测试集不能被无意带入普通开发验证。

### 审阅停点

完成一个设计轮次或 work package 后展示完整差异、验证结果和遗留问题，然后等待明确批准；不因“下一步显而易见”而自动继续。

## 3. 不机械复制的 Pi 特例

- Pi 的分支名、历史 commit、review model、credential-sensitive suite 和 monorepo 命令不是 `pi-arc` 规范。
- Pi 使用 `tsgo`、Biome 的具体规则和 package workspace 布局，只能作为第 4 轮质量研究输入。
- Pi 内部 Session、lane、tool 和 storage 类型不会自动成为 `pi-arc` 的领域语言。
- Pi 中“代码与文档冲突时代码优先”的规则适用于已经存在的产品行为；`pi-arc` 在首版实现前没有代码事实，因此 accepted 规范优先，发现不可行时必须重新评审。
- Pi 的实现文件清单不能提前转换成 `pi-arc` 的类或模块清单。

## 4. 对当前流程的约束

| Pi 模式 | `pi-arc` 落实方式 |
| --- | --- |
| sole normative spec | `docs/pi-arc.md` |
| historical/design evidence | `docs/design/`，文件头明确非规范 |
| work package status | 设计冻结前不创建 `docs/work-packages/` |
| explicit blockers | open/gated 项写入规范和每轮评审 |
| focused acceptance | 每个未来 package 绑定需求 ID 和规范章节 |
| stop for approval | 第 0 至第 5 轮以及每个未来 package 后暂停 |

