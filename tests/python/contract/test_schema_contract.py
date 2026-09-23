from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest
from pi_arc_sidecar.canonical_json import canonical_json, canonical_json_digest
from pi_arc_sidecar.schema_validator import is_valid_json_schema

ROOT = Path(__file__).parents[3]


def load_json(path: Path) -> object:
    return cast(object, json.loads(path.read_text(encoding="utf-8")))


def schema_path(schema_id: str) -> Path:
    return ROOT / "generated" / "schemas" / f"{schema_id.replace('.', '-')}.schema.json"


@pytest.mark.contract
def test_canonical_json_vectors_match() -> None:
    vectors = cast(
        list[dict[str, object]], load_json(ROOT / "tests/fixtures/contracts/canonical-vectors.json")
    )
    for vector in vectors:
        value = vector["value"]
        assert canonical_json(value) == vector["canonical"], vector["name"]
        assert canonical_json_digest(value) == vector["digest"], vector["name"]


@pytest.mark.contract
def test_schema_corpus_matches_declared_results() -> None:
    cases = cast(
        list[dict[str, object]], load_json(ROOT / "tests/fixtures/contracts/schema-corpus.json")
    )
    for test_case in cases:
        value = test_case["value"]
        schema_id = cast(str, test_case["schema"])
        schema = load_json(schema_path(schema_id))
        actual = is_valid_json_schema(value, schema)
        assert actual is test_case["valid"], test_case["name"]
