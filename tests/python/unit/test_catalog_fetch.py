"""官方 SDK 获取适配器只在临时目录运行，测试不触网也不加载真实 Game。"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest
from pi_arc_sidecar import catalog_fetch


@pytest.mark.parametrize("api_key", [None, "", "private-test-secret"])
def test_exact_official_game_is_copied_without_leaking_sdk_workspace(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    api_key: str | None,
) -> None:
    if api_key is None:
        monkeypatch.delenv("ARC_API_KEY", raising=False)
    else:
        monkeypatch.setenv("ARC_API_KEY", api_key)
    original_cwd = Path.cwd()
    calls: list[str] = []
    destination = tmp_path / "staging"
    destination.mkdir()

    class FakeArcade:
        def __init__(self, **kwargs: object) -> None:
            calls.append("construct")
            assert kwargs["arc_api_key"] == (api_key or "")
            assert kwargs["operation_mode"] == "normal"
            self.root = Path(cast(str, kwargs["environments_dir"]))
            assert self.root.parent.resolve() == Path.cwd()
            assert Path(cast(str, kwargs["recordings_dir"])).parent.resolve() == Path.cwd()
            logger = cast(logging.Logger, kwargs["logger"])
            assert logger.disabled
            logger.info("SDK key: %s", api_key or "generated-anonymous-test-secret")
            self.root.mkdir(parents=True)

        def make(self, game_id: str, **kwargs: object) -> SimpleNamespace:
            calls.append("make")
            assert game_id == "ls20-9607627b"
            assert kwargs == {"seed": 42, "save_recording": False}
            source = self.root / game_id
            source.mkdir()
            (source / "metadata.json").write_text(json.dumps({"game_id": game_id}))
            (source / "environment.py").write_text("GAME = 1\n")
            (source / "nested").mkdir()
            (source / "nested" / "asset.txt").write_text("asset")
            return SimpleNamespace(
                environment_info=SimpleNamespace(game_id=game_id, local_dir=str(source))
            )

    monkeypatch.setitem(
        sys.modules,
        "arc_agi",
        SimpleNamespace(Arcade=FakeArcade, OperationMode=SimpleNamespace(NORMAL="normal")),
    )
    real_import = catalog_fetch.importlib.import_module
    workspace: list[Path] = []

    def checked_import(name: str) -> object:
        calls.append("import")
        workspace.append(Path.cwd())
        assert Path.cwd() != original_cwd
        assert not (Path.cwd() / ".env").exists()
        assert not (Path.cwd() / ".env.example").exists()
        return real_import(name)

    monkeypatch.setattr(catalog_fetch.importlib, "import_module", checked_import)
    with caplog.at_level(logging.INFO):
        catalog_fetch.fetch("ls20-9607627b", destination)
    assert calls == ["import", "construct", "make"]
    assert Path.cwd() == original_cwd
    assert not workspace[0].exists()
    assert "private-test-secret" not in caplog.text
    assert "generated-anonymous-test-secret" not in caplog.text
    assert (destination / "environment.py").read_text() == "GAME = 1\n"
    assert (destination / "nested" / "asset.txt").read_text() == "asset"
    assert "private-test-secret" not in (destination / "metadata.json").read_text()


def test_catalog_rejects_mismatch_missing_files_and_nonempty_staging(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("ARC_API_KEY", "private-test-secret")
    destination = tmp_path / "staging"
    destination.mkdir()
    result: dict[str, object] = {"game_id": "ls20-other-version", "metadata": True}

    class FakeArcade:
        def __init__(self, **kwargs: object) -> None:
            self.root = Path(cast(str, kwargs["environments_dir"]))
            self.root.mkdir(parents=True)

        def make(self, _game_id: str, **_kwargs: object) -> SimpleNamespace | None:
            game_id = cast(str, result["game_id"])
            if game_id == "none":
                return None
            source = self.root / game_id
            source.mkdir()
            if result["metadata"]:
                (source / "metadata.json").write_text("{}")
            return SimpleNamespace(
                environment_info=SimpleNamespace(game_id=game_id, local_dir=str(source))
            )

    monkeypatch.setitem(
        sys.modules,
        "arc_agi",
        SimpleNamespace(Arcade=FakeArcade, OperationMode=SimpleNamespace(NORMAL="normal")),
    )
    with pytest.raises(ValueError, match="exact Game ID"):
        catalog_fetch.fetch("ls20-9607627b", destination)
    result["game_id"] = "none"
    with pytest.raises(ValueError, match="exact Game ID"):
        catalog_fetch.fetch("ls20-9607627b", destination)
    result["game_id"] = "ls20-9607627b"
    result["metadata"] = False
    with pytest.raises(ValueError, match="complete Environment"):
        catalog_fetch.fetch("ls20-9607627b", destination)
    result["metadata"] = True
    (destination / "occupied").write_text("x")
    with pytest.raises(ValueError, match="empty"):
        catalog_fetch.fetch("ls20-9607627b", destination)


@pytest.mark.parametrize("api_key", [None, "private-test-secret"])
@pytest.mark.parametrize("failure", ["construct", "make", "none"])
def test_catalog_failure_never_retries_with_another_identity(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    api_key: str | None,
    failure: str,
) -> None:
    if api_key is None:
        monkeypatch.delenv("ARC_API_KEY", raising=False)
    else:
        monkeypatch.setenv("ARC_API_KEY", api_key)
    original_cwd = Path.cwd()
    keys: list[object] = []
    make_calls: list[str] = []
    workspace: list[Path] = []

    class FakeArcade:
        def __init__(self, **kwargs: object) -> None:
            keys.append(kwargs["arc_api_key"])
            workspace.append(Path.cwd())
            if failure == "construct":
                raise PermissionError("fake authentication failure")

        def make(self, game_id: str, **_kwargs: object) -> None:
            make_calls.append(game_id)
            if failure == "make":
                raise PermissionError("fake authentication failure")
            return None

    monkeypatch.setitem(
        sys.modules,
        "arc_agi",
        SimpleNamespace(Arcade=FakeArcade, OperationMode=SimpleNamespace(NORMAL="normal")),
    )
    error = ValueError if failure == "none" else PermissionError
    with pytest.raises(error):
        catalog_fetch.fetch("ls20-9607627b", tmp_path)
    assert keys == [api_key or ""]
    assert make_calls == ([] if failure == "construct" else ["ls20-9607627b"])
    assert list(tmp_path.iterdir()) == []
    assert Path.cwd() == original_cwd
    assert not workspace[0].exists()


def test_cli_reports_failure_without_exception_text(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    def fail_fetch(_game_id: str, _destination: Path) -> None:
        raise ValueError("private-test-secret")

    monkeypatch.setattr(
        sys, "argv", ["catalog_fetch", "--game-id", "ls20-9607627b", "--destination", str(tmp_path)]
    )
    monkeypatch.setattr(catalog_fetch, "fetch", fail_fetch)
    assert catalog_fetch.main() == 1
    assert "private-test-secret" not in capsys.readouterr().err
