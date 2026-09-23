"""Python sidecar 的 receipt、实例隔离和完整 Frame 行为测试。"""

from __future__ import annotations

import io
import json
import sys
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any, NoReturn, cast

import pytest
from pi_arc_sidecar import sidecar as sidecar_module

OPEN_PAYLOAD: dict[str, Any] = {
    "gameId": "ls20-9607627b",
    "sourceLocator": "arc-agi://public/ls20-9607627b?sdk=0.9.9",
    "treeDigest": "a" * 64,
    "seed": 42,
}


def private(name: str) -> Callable[..., Any]:
    """以动态查找调用 sidecar 的内部校验 primitive，避免公开测试专用 API。"""

    return cast(Callable[..., Any], getattr(sidecar_module, name))


def raise_exit(code: int) -> NoReturn:
    raise SystemExit(code)


def fail_replace(*_args: object) -> NoReturn:
    raise OSError("replace failed")


def no_spec(*_args: object) -> None:
    return None


def fail_import(_name: str) -> NoReturn:
    raise RuntimeError("sdk unavailable")


def fake_sdk_import(_name: str) -> SimpleNamespace:
    class FakeArcade:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def make(self, *_args: object, **_kwargs: object) -> None:
            return None

    return SimpleNamespace(Arcade=FakeArcade, OperationMode=SimpleNamespace(OFFLINE="offline"))


def fake_engine_import(_name: str) -> SimpleNamespace:
    def from_name(name: str) -> str:
        return name

    return SimpleNamespace(GameAction=SimpleNamespace(from_name=from_name))


def fail_rglob(self: Path, pattern: str, *, case_sensitive: bool | None = None) -> NoReturn:
    del self, pattern
    del case_sensitive
    raise OSError("read failed")


def make_sidecar(tmp_path: Path) -> sidecar_module.Sidecar:
    return sidecar_module.Sidecar(
        Path("tests/fixtures/sidecar"),
        tmp_path / "cache",
        "ls20-9607627b",
        42,
        OPEN_PAYLOAD["sourceLocator"],
        OPEN_PAYLOAD["treeDigest"],
    )


def test_receipt_dedupe_and_conflict(tmp_path: Path) -> None:
    sidecar = make_sidecar(tmp_path)
    opened = sidecar.dispatch("open", OPEN_PAYLOAD)
    instance_id = opened["environmentInstanceId"]
    anchor = opened["anchor"]
    request: dict[str, Any] = {
        "environmentInstanceId": instance_id,
        "baseTurn": anchor["turn"],
        "baseObservationDigest": anchor["observationDigest"],
        "actionId": "a1",
        "action": {"name": "ACTION1", "data": {}},
    }
    first = sidecar.dispatch("submit_action", request)["receipt"]
    assert first["status"] == "complete"
    assert first["frames"] == [[[1, 1], [2, 3]]]
    assert sidecar.dispatch("submit_action", request)["receipt"] == first
    with pytest.raises(sidecar_module.SidecarFault, match="other parameters"):
        sidecar.dispatch("submit_action", {**request, "action": {"name": "ACTION7", "data": {}}})


def test_instance_mismatch_is_rejected(tmp_path: Path) -> None:
    sidecar = make_sidecar(tmp_path)
    with pytest.raises(sidecar_module.SidecarFault) as error:
        sidecar.dispatch("get_anchor", {"environmentInstanceId": "other"})
    assert error.value.code == "instance_mismatch"


def test_lookup_unknown_action_is_not_accepted(tmp_path: Path) -> None:
    sidecar = make_sidecar(tmp_path)
    opened = sidecar.dispatch("open", OPEN_PAYLOAD)
    receipt = sidecar.dispatch(
        "lookup_action",
        {
            "environmentInstanceId": opened["environmentInstanceId"],
            "actionId": "missing",
            "baseTurn": 0,
            "baseObservationDigest": opened["anchor"]["observationDigest"],
        },
    )["receipt"]
    assert receipt["status"] == "not_accepted"


def test_validation_and_atomic_cache_helpers(tmp_path: Path) -> None:
    with pytest.raises(sidecar_module.SidecarFault):
        private("_record")([], "record")
    with pytest.raises(sidecar_module.SidecarFault):
        private("_string")({}, "missing")
    with pytest.raises(sidecar_module.SidecarFault):
        private("_safe_environment_root")(str(tmp_path / "missing"))

    cache_file = tmp_path / "nested" / "state.json"
    private("_atomic_write")(cache_file, {"value": 1})
    assert private("_load_json")(cache_file, {})["value"] == 1
    assert private("_load_json")(tmp_path / "absent.json", {}) == {}
    cache_file.write_text("not json", encoding="utf-8")
    with pytest.raises(sidecar_module.SidecarFault):
        private("_load_json")(cache_file, {})

    original_replace = sidecar_module.os.replace
    try:
        sidecar_module.os.replace = fail_replace
        with pytest.raises(OSError):
            private("_atomic_write")(tmp_path / "failed.json", {"value": 1})
    finally:
        sidecar_module.os.replace = original_replace


def test_frame_and_environment_result_validation() -> None:
    assert private("_frames")([[[0, 1], [2, 3]]]) == [[[0, 1], [2, 3]]]
    with pytest.raises(sidecar_module.SidecarFault):
        private("_frame")([])
    with pytest.raises(sidecar_module.SidecarFault):
        private("_frame")([[16]])
    with pytest.raises(sidecar_module.SidecarFault):
        private("_frame")([[1], [1, 2]])
    with pytest.raises(sidecar_module.SidecarFault):
        private("_environment_result")({"frames": [[[0]]], "state": "UNKNOWN"})
    with pytest.raises(sidecar_module.SidecarFault):
        private("_environment_result")({"frames": [[[0]]], "levelsCompleted": -1})
    with pytest.raises(sidecar_module.SidecarFault):
        private("_environment_result")({"frames": [[[0]]], "availableActions": [1]})
    with pytest.raises(sidecar_module.SidecarFault):
        private("_frames")([])
    with pytest.raises(sidecar_module.SidecarFault):
        private("_frame")([[0] * 65])
    with pytest.raises(sidecar_module.SidecarFault):
        private("_frame")([[0] * 64, [0]])
    with pytest.raises(sidecar_module.SidecarFault):
        private("_frame")([[0] * 65])
    with pytest.raises(sidecar_module.SidecarFault):
        private("_frame")([[]])


def test_action_validation_and_anchor_queries(tmp_path: Path) -> None:
    sidecar = make_sidecar(tmp_path)
    opened = sidecar.dispatch("open", OPEN_PAYLOAD)
    instance = opened["environmentInstanceId"]
    anchor = opened["anchor"]
    with pytest.raises(sidecar_module.SidecarFault, match="ACTION6"):
        sidecar.dispatch(
            "submit_action",
            {
                "environmentInstanceId": instance,
                "baseTurn": anchor["turn"],
                "baseObservationDigest": anchor["observationDigest"],
                "actionId": "bad-coordinate",
                "action": {"name": "ACTION6", "data": {"x": 64, "y": 0}},
            },
        )
    with pytest.raises(sidecar_module.SidecarFault, match="retry_state"):
        sidecar.dispatch(
            "submit_action",
            {
                "environmentInstanceId": instance,
                "baseTurn": anchor["turn"],
                "baseObservationDigest": anchor["observationDigest"],
                "actionId": "bad-reset",
                "action": {"name": "RESET", "data": {"retry_state": "x"}},
            },
        )
    assert sidecar.dispatch("get_anchor", {"environmentInstanceId": instance})["anchor"] == anchor
    assert sidecar.dispatch("close", {"environmentInstanceId": instance})["closed"] is True


def test_module_and_environment_failure_paths(tmp_path: Path) -> None:
    bad_root = tmp_path / "bad"
    bad_root.mkdir()
    (bad_root / "metadata.json").write_text('{"entrypoint": "../escape.py"}', encoding="utf-8")
    with pytest.raises(sidecar_module.SidecarFault):
        private("_load_module")(bad_root)
    (bad_root / "metadata.json").write_text('{"entrypoint": "missing.py"}', encoding="utf-8")
    with pytest.raises(sidecar_module.SidecarFault):
        private("_load_module")(bad_root)

    no_factory = tmp_path / "no-factory"
    no_factory.mkdir()
    (no_factory / "metadata.json").write_text('{"entrypoint": "environment.py"}', encoding="utf-8")
    (no_factory / "environment.py").write_text("VALUE = 1\n", encoding="utf-8")
    with pytest.raises(sidecar_module.SidecarFault):
        sidecar_module.Environment.load(no_factory, 42, tmp_path / "cache", "game")

    original_spec = sidecar_module.importlib.util.spec_from_file_location
    try:
        sidecar_module.importlib.util.spec_from_file_location = no_spec
        with pytest.raises(sidecar_module.SidecarFault):
            private("_load_module")(Path("tests/fixtures/sidecar"))
    finally:
        sidecar_module.importlib.util.spec_from_file_location = original_spec

    empty = sidecar_module.Environment(object())
    with pytest.raises(sidecar_module.SidecarFault):
        empty.reset()
    with pytest.raises(sidecar_module.SidecarFault):
        empty.step("ACTION1", {})


def test_pending_and_dispatch_error_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    sidecar = make_sidecar(tmp_path)
    opened = sidecar.dispatch("open", OPEN_PAYLOAD)
    base = {
        "environmentInstanceId": opened["environmentInstanceId"],
        "baseTurn": opened["anchor"]["turn"],
        "baseObservationDigest": opened["anchor"]["observationDigest"],
    }
    with pytest.raises(sidecar_module.SidecarFault):
        sidecar.dispatch("unknown", {})
    with pytest.raises(sidecar_module.SidecarFault):
        sidecar.dispatch(
            "submit_action", {**base, "actionId": "bad", "action": {"name": "BOGUS", "data": {}}}
        )
    with pytest.raises(sidecar_module.SidecarFault):
        sidecar.dispatch(
            "submit_action",
            {**base, "actionId": "bad-data", "action": {"name": "ACTION1", "data": []}},
        )
    with pytest.raises(sidecar_module.SidecarFault):
        sidecar.dispatch(
            "submit_action",
            {**base, "actionId": "extra", "action": {"name": "ACTION1", "data": {}, "extra": True}},
        )
    with pytest.raises(sidecar_module.SidecarFault):
        sidecar.dispatch(
            "submit_action",
            {**base, "actionId": "unavailable", "action": {"name": "ACTION2", "data": {}}},
        )

    monkeypatch.setenv("PI_ARC_SIDECAR_CRASH_AFTER_ACCEPT", "1")
    monkeypatch.setattr(sidecar_module.os, "_exit", raise_exit)
    with pytest.raises(SystemExit):
        sidecar.dispatch(
            "submit_action",
            {**base, "actionId": "pending", "action": {"name": "ACTION1", "data": {}}},
        )
    assert sidecar.receipts["pending"]["status"] == "pending"


def test_response_and_offline_containment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PI_ARC_TEST_SECRET", "secret")
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid")
    monkeypatch.setenv("PI_ARC_BLOCK_NETWORK", "1")
    private("_configure_offline_process")()
    assert "PI_ARC_TEST_SECRET" not in sidecar_module.os.environ
    with pytest.raises(RuntimeError, match="network disabled"):
        sidecar_module.socket.create_connection(("127.0.0.1", 9))
    assert (
        private("_response")({"requestId": "r", "type": "open"}, payload={"ok": True})["ok"] is True
    )
    error = sidecar_module.SidecarFault("unexpected", "bad")
    assert private("_response")({}, error=error)["error"]["code"] == "internal"


def test_environment_projection_and_sdk_failure_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    metadata_root = tmp_path / "metadata"
    metadata_root.mkdir()
    (metadata_root / "metadata.json").write_text('{"game_id": "game"}', encoding="utf-8")
    with pytest.raises(sidecar_module.SidecarFault, match="identity"):
        sidecar_module.Environment.load(metadata_root, 42, tmp_path / "cache", "other")

    original_import = sidecar_module.importlib.import_module
    monkeypatch.setattr(sidecar_module.importlib, "import_module", fail_import)
    with pytest.raises(sidecar_module.SidecarFault, match="offline ARC SDK"):
        sidecar_module.Environment.load(metadata_root, 42, tmp_path / "cache", "game")

    monkeypatch.setattr(sidecar_module.importlib, "import_module", fake_sdk_import)
    with pytest.raises(sidecar_module.SidecarFault, match="did not find"):
        sidecar_module.Environment.load(metadata_root, 42, tmp_path / "cache", "game")
    monkeypatch.setattr(sidecar_module.importlib, "import_module", original_import)

    class Frame:
        def tolist(self) -> list[list[int]]:
            return [[1]]

    observation = SimpleNamespace(
        state=SimpleNamespace(value="WIN"),
        frame=[Frame()],
        levels_completed=2,
        win_levels=1,
        available_actions=[1, 99],
    )
    assert private("_arcade_result")(observation)["state"] == "WIN"
    with pytest.raises(sidecar_module.SidecarFault):
        private("_arcade_result")(None)

    class FakeWrapper:
        def reset(self) -> SimpleNamespace:
            return observation

        def step(self, _action: object, _data: dict[str, Any]) -> SimpleNamespace:
            return observation

    arcade_environment = sidecar_module.ArcadeEnvironment(FakeWrapper())
    assert arcade_environment.reset()["levelsCompleted"] == 2
    monkeypatch.setattr(
        sidecar_module.importlib,
        "import_module",
        fake_engine_import,
    )
    assert arcade_environment.step("ACTION1", {})["winLevels"] == 1


def test_safe_root_and_startup_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    target = tmp_path / "target"
    target.mkdir()
    link = tmp_path / "link"
    link.symlink_to(target, target_is_directory=True)
    with pytest.raises(sidecar_module.SidecarFault, match="symlink"):
        private("_safe_environment_root")(str(link))
    unsafe = target / "unsafe"
    unsafe.symlink_to(target, target_is_directory=True)
    with pytest.raises(sidecar_module.SidecarFault, match="unsafe"):
        private("_safe_environment_root")(str(target))

    original_rglob = Path.rglob
    try:
        Path.rglob = fail_rglob
        with pytest.raises(sidecar_module.SidecarFault, match="cannot be read"):
            private("_safe_environment_root")(str(target))
    finally:
        Path.rglob = original_rglob

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "sidecar",
            "--environment-root",
            str(tmp_path / "missing"),
            "--cache-root",
            str(tmp_path / "cache"),
            "--game-id",
            "game",
            "--seed",
            "42",
            "--source-locator",
            "source",
            "--tree-digest",
            "a" * 64,
        ],
    )
    monkeypatch.setattr(sys, "stdin", io.StringIO(""))
    assert sidecar_module.main() == 1
    assert "unavailable" in capsys.readouterr().out


def test_main_process_boundary_and_wire_rejection(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    cache = tmp_path / "cache"
    request = {
        "schema": sidecar_module.SCHEMA,
        "requestId": "r1",
        "type": "open",
        "payload": OPEN_PAYLOAD,
    }
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "sidecar",
            "--environment-root",
            "tests/fixtures/sidecar",
            "--cache-root",
            str(cache),
            "--game-id",
            "ls20-9607627b",
            "--seed",
            "42",
            "--source-locator",
            OPEN_PAYLOAD["sourceLocator"],
            "--tree-digest",
            OPEN_PAYLOAD["treeDigest"],
        ],
    )
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(request) + "\n"))
    assert sidecar_module.main() == 0
    assert json.loads(capsys.readouterr().out)["ok"] is True
