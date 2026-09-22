from __future__ import annotations

import ast
import sys
from pathlib import Path

SOURCE_ROOT = Path("python")
PACKAGE_ROOT = SOURCE_ROOT / "pi_arc_sidecar"
ALLOWED_EXTERNAL_ROOTS = frozenset({"PIL", "arc_agi", "arcengine"})


def collect_python(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*.py") if "__pycache__" not in path.parts)


def boundary_violations(root: Path) -> list[str]:
    violations: list[str] = []
    for file in collect_python(root):
        try:
            relative = file.relative_to(root)
        except ValueError:
            violations.append(f"{file}: Python source escapes its package root")
            continue
        package_depth = len(relative.parent.parts) + 1
        tree = ast.parse(file.read_text(encoding="utf-8"), filename=str(file))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            imported_roots: set[str] = set()
            if isinstance(node, ast.Import):
                imported_roots.update(alias.name.partition(".")[0] for alias in node.names)
            else:
                if node.level > package_depth:
                    violations.append(
                        f"{file}:{node.lineno}: relative import escapes pi_arc_sidecar"
                    )
                    continue
                if node.level == 0 and node.module is not None:
                    imported_roots.add(node.module.partition(".")[0])
            for imported_root in imported_roots:
                if (
                    imported_root not in sys.stdlib_module_names
                    and imported_root != "pi_arc_sidecar"
                    and imported_root not in ALLOWED_EXTERNAL_ROOTS
                ):
                    violations.append(
                        f"{file}:{node.lineno}: Python adapter cannot import external module {imported_root}"
                    )
    return violations


def main() -> None:
    expected = boundary_violations(
        Path("tests/architecture-fixtures/invalid/python/pi_arc_sidecar")
    )
    if not expected:
        raise RuntimeError("Python architecture checker negative-fixture self-test failed")
    violations = [
        f"{file}: production Python source must belong to pi_arc_sidecar"
        for file in collect_python(SOURCE_ROOT)
        if not file.is_relative_to(PACKAGE_ROOT)
    ]
    violations.extend(boundary_violations(PACKAGE_ROOT))
    if violations:
        raise RuntimeError("\n".join(violations))
    print(f"Python import boundary: OK (negative fixture produced {len(expected)} violation)")


if __name__ == "__main__":
    main()
