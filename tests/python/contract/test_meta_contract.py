from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

FIXTURES = Path("tests/fixtures/meta")


def is_meta_fixture(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    unknown_record = cast(dict[object, object], value)
    if not all(isinstance(key, str) for key in unknown_record):
        return False
    record = cast(dict[str, object], unknown_record)
    return (
        set(record) == {"schema", "value"}
        and record["schema"] == "pi-arc.meta-fixture.v1"
        and record["value"] == "ok"
    )


def load_fixture(name: str) -> object:
    return cast(object, json.loads((FIXTURES / name).read_text(encoding="utf-8")))


@pytest.mark.contract
def test_accepts_valid_meta_fixture() -> None:
    assert is_meta_fixture(load_fixture("valid.json"))


@pytest.mark.contract
def test_rejects_unknown_fields() -> None:
    assert not is_meta_fixture(load_fixture("invalid.json"))
