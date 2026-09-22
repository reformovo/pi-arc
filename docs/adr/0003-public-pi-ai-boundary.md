---
status: accepted
accepted: 2026-09-22
---

# 模型接入只依赖公开 pi-ai 边界

`pi-arc` 只通过公开 `pi-ai` 的 `Models`、model identity 和 `CredentialStore` 边界接入模型，不依赖 coding-agent 私有 `ModelRuntime`、私有 payload 改写或实验性 provider surface。这样会放弃部分 coding-agent 内部便利能力，但能让 SDK、凭据处理和升级路径建立在发布包契约上，并避免把 Pi 私有 runtime 类型泄漏成 ARC 领域接口。
