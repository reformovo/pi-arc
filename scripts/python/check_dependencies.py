from __future__ import annotations

import sys
import tomllib
from importlib.metadata import version as installed_version
from pathlib import Path

EXPECTED_RUNTIME = {
    "arc-agi": "0.9.9",
    "arcengine": "0.9.3",
    "pillow": "12.2.0",
}
EXPECTED_DEV = {
    "coverage": "7.10.7",
    "pytest": "8.4.2",
    "pytest-cov": "7.0.0",
    "ruff": "0.16.6",
}


def parse_pins(values: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for value in values:
        if value.count("==") != 1:
            raise ValueError(f"dependency must use one exact == pin: {value}")
        name, version = value.split("==", 1)
        result[name] = version
    return result


def main() -> None:
    document = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))
    project = document["project"]
    if project["requires-python"] != "==3.12.9":
        raise ValueError("requires-python must be exactly 3.12.9")
    if parse_pins(project["dependencies"]) != EXPECTED_RUNTIME:
        raise ValueError("Python runtime pins differ from the accepted specification")
    if parse_pins(document["dependency-groups"]["dev"]) != EXPECTED_DEV:
        raise ValueError("Python dev pins differ from the accepted specification")
    for name, expected in (EXPECTED_RUNTIME | EXPECTED_DEV).items():
        actual = installed_version(name)
        if actual != expected:
            raise ValueError(f"installed {name} must be {expected}, got {actual}")
    if sys.version_info[:3] != (3, 12, 9):
        raise ValueError(f"Python must be 3.12.9, got {sys.version.split()[0]}")


if __name__ == "__main__":
    main()
