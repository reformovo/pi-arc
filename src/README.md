# TypeScript 目录所有权

- `domain/`：纯领域规则，只依赖自身。
- `application/`：用例与 controller，只依赖 domain 和 protocol ports。
- `protocol/`：跨边界类型、schema 与纯验证。
- `adapters/`：Pi、存储、文件系统、clock/ID 与 Python transport 的 ports 实现；adapter 之间不得互相依赖。
- `composition/`：唯一可以装配具体 adapters 的位置，未来 CLI/SDK 入口也归这里。

依赖方向由 `scripts/check-boundaries.mjs` 强制；本文件只记录目录到规范所有权的机械映射，不定义业务设计。
