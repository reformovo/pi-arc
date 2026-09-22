---
status: accepted
started: 2026-09-22
implementation-completed: 2026-09-22
accepted: 2026-09-22
---

# WP-01：项目骨架与质量门禁

## 目标

建立 TypeScript/Python docs-compatible skeleton、精确依赖与 lockfile、只读质量命令和 CI required checks。只证明开发与测试基础设施有效，不实现 ARC、Environment、controller、tool、CLI/SDK 行为或 Pi runtime adapter。

## 必须交付

- 精确固定规范 14.2、15.2 节版本的 `package.json`、`package-lock.json`、`pyproject.toml`、`uv.lock` 和 runtime version files；
- Biome、TypeScript、Ruff、Pyright、Vitest、Pytest/coverage 配置；
- domain、application、protocol、adapter、composition 和 Python adapter 的目录所有权映射与 import-boundary checker；
- 八个 required check 的 SHA-pinned GitHub Actions workflow、stable npm scripts 和 tracked-worktree drift check；
- 最小 meta-fixture：architecture checker 的故意违规样例、TS/Python test runner、network/secret sentinel、contract/integration plumbing；
- package 完成评审记录。所有 meta-fixture 都不得表达 ARC 业务行为。

## 验证责任

关闭 handoff 中分配给 WP-01 的全部 `S-*`、`T-BOUNDARY-CHECK-001` 和 `M-*`。特别验证 direct pins、lock drift、suppression、generated/asset exclusions、CI read-only、VISTA/旧项目无 dependency。

## 验证命令

依次执行 handoff 第 6 节的全部安装与 gate 命令。运行前后 `git status --short` 的 tracked diff 必须一致；测试不得使用 `passWithNoTests`。

## 停止点

展示文件清单、配置取舍、CI job、全部命令输出和剩余风险后暂停。用户已于 2026-09-22 确认 WP-01；WP-02 仍需单独授权后才能开始。
