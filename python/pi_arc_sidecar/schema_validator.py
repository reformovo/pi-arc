from __future__ import annotations

import re
from typing import cast

from .canonical_json import canonical_json

type SchemaObject = dict[str, object]


def _value_type(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, list):
        return "array"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _matches_type(value: object, expected: object) -> bool:
    expected_types = (
        [expected]
        if isinstance(expected, str)
        else [item for item in cast(list[object], expected) if isinstance(item, str)]
        if isinstance(expected, list)
        else []
    )
    return _value_type(value) in expected_types


def _equals(left: object, right: object) -> bool:
    if isinstance(left, dict) and isinstance(right, dict):
        return canonical_json(cast(dict[str, object], left)) == canonical_json(
            cast(dict[str, object], right)
        )
    if isinstance(left, list) and isinstance(right, list):
        return canonical_json(cast(list[object], left)) == canonical_json(cast(list[object], right))
    return left == right


def _validate(value: object, schema: SchemaObject, location: str, errors: list[str]) -> None:
    if "const" in schema and not _equals(value, schema["const"]):
        errors.append(f"{location}: does not match const")
    enum = schema.get("enum")
    if isinstance(enum, list) and not any(
        _equals(value, item) for item in cast(list[object], enum)
    ):
        errors.append(f"{location}: unknown enum value")
    schema_type = schema.get("type")
    if schema_type is not None and not _matches_type(value, schema_type):
        errors.append(f"{location}: expected {schema_type!r}, got {_value_type(value)}")
        return
    if isinstance(value, str):
        minimum = schema.get("minLength")
        maximum = schema.get("maxLength")
        pattern = schema.get("pattern")
        if isinstance(minimum, int) and len(value) < minimum:
            errors.append(f"{location}: string too short")
        if isinstance(maximum, int) and len(value) > maximum:
            errors.append(f"{location}: string too long")
        if isinstance(pattern, str) and re.fullmatch(pattern, value) is None:
            errors.append(f"{location}: pattern mismatch")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if isinstance(minimum, (int, float)) and value < minimum:
            errors.append(f"{location}: below minimum")
        if isinstance(maximum, (int, float)) and value > maximum:
            errors.append(f"{location}: above maximum")
    if isinstance(value, list):
        items = cast(list[object], value)
        minimum = schema.get("minItems")
        if isinstance(minimum, int) and len(items) < minimum:
            errors.append(f"{location}: too few items")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            typed_schema = cast(SchemaObject, item_schema)
            for index, item in enumerate(items):
                _validate(item, typed_schema, f"{location}[{index}]", errors)
    if not isinstance(value, dict):
        return
    properties = schema.get("properties")
    property_map = cast(dict[str, object], properties) if isinstance(properties, dict) else {}
    required = schema.get("required")
    if isinstance(required, list):
        for field in cast(list[object], required):
            if isinstance(field, str) and field not in value:
                errors.append(f"{location}: missing {field}")
    record = cast(dict[str, object], value)
    if schema.get("additionalProperties") is False:
        for field in record:
            if field not in property_map:
                errors.append(f"{location}: unknown field {field}")
    for field, property_schema in property_map.items():
        if field in value and isinstance(property_schema, dict):
            _validate(
                record[field], cast(SchemaObject, property_schema), f"{location}.{field}", errors
            )


def validate_json_schema(value: object, schema: object) -> list[str]:
    if not isinstance(schema, dict):
        return ["$: schema is not an object"]
    errors: list[str] = []
    _validate(value, cast(SchemaObject, schema), "$", errors)
    return errors


def is_valid_json_schema(value: object, schema: object) -> bool:
    return not validate_json_schema(value, schema)
