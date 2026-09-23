from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest
from pi_arc_sidecar.canonical_json import canonical_json, canonical_json_digest
from pi_arc_sidecar.schema_validator import is_valid_json_schema, validate_json_schema

ROOT = Path(__file__).parents[3]


def load_json(path: Path) -> object:
    return cast(object, json.loads(path.read_text(encoding="utf-8")))


def schema_path(schema_id: str) -> Path:
    return ROOT / "generated" / "schemas" / f"{schema_id.replace('.', '-')}.schema.json"


def test_canonical_vectors_and_rejection_edges() -> None:
    vectors = cast(
        list[dict[str, object]], load_json(ROOT / "tests/fixtures/contracts/canonical-vectors.json")
    )
    for vector in vectors:
        value = vector["value"]
        assert canonical_json(value) == vector["canonical"]
        assert canonical_json_digest(value) == vector["digest"]
    with pytest.raises(TypeError, match="safe integer"):
        canonical_json(9007199254740992)
    with pytest.raises(TypeError, match="unsupported JSON value"):
        canonical_json(1.5)


def test_schema_corpus_and_validator_edges() -> None:
    cases = cast(
        list[dict[str, object]], load_json(ROOT / "tests/fixtures/contracts/schema-corpus.json")
    )
    for test_case in cases:
        schema_id = cast(str, test_case["schema"])
        schema = load_json(schema_path(schema_id))
        assert is_valid_json_schema(test_case["value"], schema) is test_case["valid"]

    assert validate_json_schema({}, {"type": "object", "required": ["required"]})
    assert validate_json_schema(1, {"type": "string"})
    assert validate_json_schema([], {"type": "array", "minItems": 1})
    assert validate_json_schema(
        {"known": 1, "unknown": 2},
        {
            "type": "object",
            "additionalProperties": False,
            "properties": {"known": {"type": "integer"}},
        },
    )
    assert validate_json_schema("bad", {"type": ["integer", "null"]})
    assert validate_json_schema(
        {"x": 1},
        {"type": "object", "properties": {"x": {"type": "integer", "minimum": 2, "maximum": 0}}},
    )
