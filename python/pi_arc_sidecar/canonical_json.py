"""生成 pi-arc digest contract 使用的跨 runtime 规范化 JSON 字节。

本模块与 TypeScript 的字节级 contract 保持一致。它负责确定性编码和 SHA-256
便捷函数。它不负责 artifact 持久化。
"""

from __future__ import annotations

import hashlib
import json
from typing import cast

type JsonValue = object


def _encode(value: JsonValue) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        # 两端都限制为 JavaScript safe integer。这样可避免同一 contract 值
        # 在传输后出现不同的数字文本表示或精度。
        if not -(2**53 - 1) <= value <= 2**53 - 1:
            raise TypeError("canonical JSON only accepts safe integer numbers")
        return str(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        items = cast(list[object], value)
        return f"[{','.join(_encode(item) for item in items)}]"
    if isinstance(value, dict):
        record = cast(dict[str, object], value)
        # Python 按 Unicode code point 排序字符串。因此包括增补平面字符在内的
        # 所有字符都能与 TypeScript 的显式 comparator 保持一致。
        pairs = [
            f"{json.dumps(key, ensure_ascii=False)}:{_encode(record[key])}"
            for key in sorted(record)
        ]
        return f"{{{','.join(pairs)}}}"
    raise TypeError(f"unsupported JSON value: {type(value).__name__}")


def canonical_json(value: JsonValue) -> str:
    """返回唯一的紧凑 JSON 文本。末尾恰有一个换行符。"""

    return f"{_encode(value)}\n"


def canonical_json_bytes(value: JsonValue) -> bytes:
    """将规范化 JSON 编码为 pi-arc digest 所覆盖的 UTF-8 字节。"""

    return canonical_json(value).encode("utf-8")


def canonical_json_digest(value: JsonValue) -> str:
    """返回规范化协议值的小写 SHA-256 digest。"""

    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()
