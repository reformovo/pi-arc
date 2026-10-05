---
status: blocked
blocked-by: 单独的用户实施授权（WP-09 已 accepted）
---

# WP-10：最终 conformance 与退役就绪证据

## 目标

运行完整规范验证矩阵、跨平台门禁和 VISTA 行为覆盖复核，生成发布与旧项目退役就绪报告。本包不删除项目、不迁移旧资产、不运行真实模型。

## 必须交付

- R-001..R-060 与所有验证 ID 的最终双向报告；
- 第 12.10 节全部故障矩阵的 offline test evidence；
- Ubuntu required CI 与 macOS arm64 offline suite 结果；
- VISTA 行为覆盖、Pi 0.86 public API、dependency/import 和历史文档不变性复核；
- 可选 official Game 获取 smoke 的独立操作说明；实际网络执行必须另获批准且不属于 required check；
- 退役就绪报告：新数据已重新获取、等价性验收结果、保留材料和未满足 gate。不得创建退役 ADR 或执行删除。

## 验证责任

T-FAULT-MATRIX-001、S-HISTORY-001、M-BRANCH-001、M-RETIRE-001，以及 WP-01..09 全部验证 ID 的最终回归。

## 验证命令

```text
npm ci --ignore-scripts --no-audit --no-fund
uv sync --locked --all-groups --python 3.12.9
uv lock --check
npm run check
git diff --check
git status --short
```

## 停止点

交付 conformance 与退役就绪报告后暂停。即使全部通过，也必须由用户另行批准 `memo-docs` 退役 ADR 和具体删除操作；本 work package 永不包含删除。
