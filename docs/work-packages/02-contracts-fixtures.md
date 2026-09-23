---
status: accepted
started: 2026-09-22
implementation-completed: 2026-09-22
accepted: 2026-09-22
---

# WP-02：版本化 contract 与共享 fixtures

## 目标

把 accepted 规范中的公共 JSON、tool、CLI event、SDK data、artifact record 和 sidecar envelope 表达成单一 source of truth、生成的 JSON Schema/类型与 TS/Python 共享 fixture。不得实现业务状态转换、Environment 或 Pi tool loop。

## 必须交付

- canonical JSON bytes/digest 的 TS/Python 实现与跨语言 test vectors；
- v1 schema family 及 valid/invalid corpus，覆盖未知字段、未知枚举、major mismatch、Unicode、整数边界和 digest；
- 只读 schema generation/drift check；
- 双端 contract runner，确保同一 fixture 在 TS/Python 结论一致；
- 不含真实 game、secret、provider transcript 的小型 committed fixtures。

## 验证责任

T-JSON-CANONICAL-001、T-SCHEMA-CORPUS-001、S-GENERATED-001。

## 验证命令

```text
npm run test:contract
npm run check:types
npm run check:spec
npm run check
git diff --check
```

## 停止点

展示 schema 清单、fixture matrix、双端结果与 generated drift 证明后暂停。用户已于 2026-09-22 确认 WP-02；WP-03 仍需单独授权后才能开始。
