# Python Environment adapter

该包是 Python Environment 的进程边界。它只通过版本化 wire protocol 与共享 contract fixtures 同 TypeScript 对齐，不读取 Pi session、模型凭据或任意 artifact 文件。

生产依赖的允许范围由 `scripts/python/check_boundaries.py` 强制。
