---
status: accepted
---

# 信任官方 Game 并允许 SDK 在获取阶段加载代码

## 决策

用户明确选择信任官方 Game，并接受获取阶段 Game code 接触 ARC 下载凭据。保留 `arc-agi==0.9.9` 官方 SDK 获取方式，允许独立获取进程调用 `Arcade.make()` 时下载并临时加载官方 Game；不再要求下载阶段完全不执行 Environment code。

正式 Run 仍从已验证缓存启动无凭据的 offline Python Environment sidecar。获取进程不是运行中的 Environment 实例，不产生 Run 的 Action、Observation 或 receipt Evidence；获取时的 SDK 初始化结果不得作为 Run 的初始 Observation。

## 原因与备选方案

- 官方 catalog 已是代码信任根。允许 SDK 的公开获取路径可减少自建 HTTP 下载器的协议维护和兼容成本。
- download-only HTTP 方案能避免获取期间执行 Game，但需要另行验证接口稳定性并维护适配器；在用户接受上述信任边界后不选择该方案。
- 等待 SDK 提供公开 download-only API 会使进度依赖外部交付，不选择该方案。
- 不采用宿主持有整个运行环境的方案；保留 sidecar、controller、receipt、恢复和审计契约。

## 后果与边界

- 获取进程允许持有 ARC 下载凭据，但必须清除模型/provider/OAuth 凭据与 Pi 配置，不传入 Pi session 或 Run artifact root；凭据不得写入缓存、日志或运行产物。
- 官方 Game code 可能在获取期间访问 ARC 凭据及获取进程可访问的资源。这是明确接受的风险；普通子进程、环境变量过滤和 digest 不构成针对恶意 Python 的安全 sandbox。
- 精确 versioned Game ID、staging、文件校验、不可变缓存和来源记录要求不变。正式 Run 必须在另一个无下载凭据的 offline sidecar 中重新创建 Environment。
- 此决策不授权真实下载、真实模型调用、WP-09 验收或 WP-10 开始。
- 此决策只允许使用 ARC 凭据，不把 ARC key 变为所有 cache miss 的必要条件。WP-09 收尾已删除原草案强制 key 的条件：缺省使用 SDK 公开匿名路径，显式 key 失败不切换匿名重试；若未来要强制 key，需要另行明确批准。

规范性行为见 [`docs/pi-arc.md` 第 15.6 节](../pi-arc.md#156-game-获取与缓存契约)。历史阻塞与后续验证见 [WP-09 评审记录](../reviews/wp-09.md)。
