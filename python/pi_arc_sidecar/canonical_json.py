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
        pairs = [
            f"{json.dumps(key, ensure_ascii=False)}:{_encode(record[key])}"
            for key in sorted(record)
        ]
        return f"{{{','.join(pairs)}}}"
    raise TypeError(f"unsupported JSON value: {type(value).__name__}")


def canonical_json(value: JsonValue) -> str:
    return f"{_encode(value)}\n"


def canonical_json_bytes(value: JsonValue) -> bytes:
    return canonical_json(value).encode("utf-8")


def canonical_json_digest(value: JsonValue) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()
