---
status: blocked
blocked-by: WP-03 acceptance
---

# WP-04：Game resolver、cache 与视觉管线

## 目标

实现规范 15.6 节的 versioned Game resolver/cache/digest，以及 Raw Frame validation、1024×1024 Visual、ACTION6 映射和像素采样纯逻辑。required tests 只使用 fake catalog 与 committed minimal game fixture。

## 必须交付

- full Game ID、staging publish、immutable digest directory、game-offline 和 old-project no-fallback；
- symlink/path traversal/unlisted file/digest mismatch 拒绝；
- 1..64 原始整数网格与颜色 0..15 validation；
- deterministic 1024 Visual/region/read-pixel primitives 和 0/15/16/1023 映射 test；
- injected catalog port；本包不得访问 official catalog 或执行下载的 Python code。

## 验证责任

S-ASSET-001、T-DATA-001、T-GAME-RESOLVER-001、T-GAME-DIGEST-001、T-COORD-001、T-VISUAL-001/002。

## 验证命令

```text
npm run test:ts
npm run test:py
npm run test:contract
npm run check
git diff --check
```

## 停止点

展示 cache tree、digest vectors、Visual golden 和 no-network/no-old-path 证明后暂停。不得实现 sidecar。
