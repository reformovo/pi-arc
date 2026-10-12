"""Python sidecar 的 receipt、实例隔离和完整 Frame 行为测试。"""

from __future__ import annotations

import io
import json
import os
import subprocess
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


def test_lifecycle_reset_is_independent_of_simple_action_availability(tmp_path: Path) -> None:
    sidecar = sidecar_module.Sidecar(
        Path("tests/fixtures/lifecycle"),
        tmp_path / "cache",
        "ls20-9607627b",
        42,
        OPEN_PAYLOAD["sourceLocator"],
        OPEN_PAYLOAD["treeDigest"],
    )

    def request(action_id: str, name: str) -> dict[str, Any]:
        anchor = sidecar.dispatch("get_anchor", {"environmentInstanceId": sidecar.instance_id})[
            "anchor"
        ]
        return {
            "environmentInstanceId": sidecar.instance_id,
            "baseTurn": anchor["turn"],
            "baseObservationDigest": anchor["observationDigest"],
            "actionId": action_id,
            "action": {"name": name, "data": {}},
        }

    with pytest.raises(sidecar_module.SidecarFault, match="RESET requires GAME_OVER"):
        sidecar.dispatch("submit_action", request("early-reset", "RESET"))
    with pytest.raises(sidecar_module.SidecarFault, match="not available"):
        sidecar.dispatch("submit_action", request("unavailable", "ACTION2"))
    failed = sidecar.dispatch("submit_action", request("fail", "ACTION1"))["receipt"]
    assert failed["resultState"] == "GAME_OVER"
    assert failed["observation"]["availableActions"] == ["ACTION1", "ACTION7"]
    with pytest.raises(sidecar_module.SidecarFault, match="GAME_OVER requires RESET"):
        sidecar.dispatch("submit_action", request("ordinary-after-game-over", "ACTION7"))
    reset_request = request("reset", "RESET")
    reset = sidecar.dispatch("submit_action", reset_request)["receipt"]
    assert reset["resultState"] == "NOT_FINISHED"
    assert reset["turn"] == 2
    assert sidecar.dispatch("submit_action", reset_request)["receipt"] == reset
    assert sidecar.turn == 2
    assert sidecar.dispatch("lookup_action", reset_request)["receipt"] == reset
    with pytest.raises(sidecar_module.SidecarFault, match="RESET requires GAME_OVER"):
        sidecar.dispatch("submit_action", request("second-reset", "RESET"))
    win = sidecar.dispatch("submit_action", request("win", "ACTION7"))["receipt"]
    assert win["resultState"] == "WIN"
    assert win["turn"] == 3
    with pytest.raises(sidecar_module.SidecarFault, match="RESET requires GAME_OVER"):
        sidecar.dispatch("submit_action", request("reset-after-win", "RESET"))
    with pytest.raises(sidecar_module.SidecarFault, match="not available"):
        sidecar.dispatch("submit_action", request("action-after-win", "ACTION7"))


@pytest.mark.parametrize("state", ["NOT_PLAYED", "NOT_FINISHED", "WIN"])
def test_reset_outside_game_over_rejected_even_when_listed(tmp_path: Path, state: str) -> None:
    sidecar = make_sidecar(tmp_path)
    sidecar.terminal_state = state
    sidecar.observation["availableActions"] = ["RESET"]
    with pytest.raises(sidecar_module.SidecarFault, match="RESET requires GAME_OVER"):
        sidecar.dispatch(
            "submit_action",
            {
                "environmentInstanceId": sidecar.instance_id,
                "baseTurn": sidecar.turn,
                "baseObservationDigest": sidecar.observation_digest,
                "actionId": "reset",
                "action": {"name": "RESET", "data": {}},
            },
        )
    assert sidecar.turn == 0
    assert not sidecar.receipts


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
    observation.state = SimpleNamespace(value="GAME_OVER")
    observation.available_actions = [1, 2, 3, 4, 5, 6]
    assert private("_arcade_result")(observation)["availableActions"] == [
        "ACTION1",
        "ACTION2",
        "ACTION3",
        "ACTION4",
        "ACTION5",
        "ACTION6",
    ]
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


@pytest.mark.parametrize("startup_failure", [False, True])
def test_process_stdout_is_protocol_only(tmp_path: Path, startup_failure: bool) -> None:
    """真实进程覆盖 import/reset/step 日志及 fd 1 写入，不放宽 JSONL parser。"""

    root = tmp_path / "environment"
    root.mkdir()
    (root / "metadata.json").write_text('{"entrypoint":"environment.py"}', encoding="utf-8")
    source = Path("tests/fixtures/sidecar/environment.py").read_text(encoding="utf-8")
    noise = (
        "import os, logging, sys\n"
        'print("game print diagnostic", flush=True)\n'
        'os.write(1, b"native diagnostic\\n")\n'
        "logging.basicConfig(stream=sys.stdout, level=logging.INFO, force=True)\n"
        'logging.info("SDK logger diagnostic")\n'
    )
    source = source.replace(
        "        self.steps = 0",
        '        print("reset diagnostic", flush=True)\n        self.steps = 0',
    )
    source = source.replace(
        "        del data", '        print("step diagnostic", flush=True)\n        del data'
    )
    if startup_failure:
        source = source.replace(
            "    return FixtureEnvironment(seed)",
            '    raise RuntimeError("fixture startup failure")',
        )
    (root / "environment.py").write_text(noise + source, encoding="utf-8")
    # 不继承主进程凭据或 cwd 的 .env；解释器路径保留 venv，不解析 symlink。
    command = [
        sys.executable,
        "-m",
        "pi_arc_sidecar.sidecar",
        "--environment-root",
        str(root),
        "--cache-root",
        str(tmp_path / "receipts"),
        "--game-id",
        "ls20-9607627b",
        "--seed",
        "42",
        "--source-locator",
        OPEN_PAYLOAD["sourceLocator"],
        "--tree-digest",
        OPEN_PAYLOAD["treeDigest"],
    ]
    env = {
        "PATH": os.defpath,
        "PYTHONPATH": str(Path("python").resolve()),
        "PI_ARC_BLOCK_NETWORK": "1",
    }
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=tmp_path,
        env=env,
    )
    try:
        assert process.stdin is not None and process.stdout is not None
        request = {
            "schema": "pi-arc.sidecar.v1",
            "requestId": "open1",
            "type": "open",
            "payload": OPEN_PAYLOAD,
        }
        process.stdin.write(json.dumps(request) + "\n")
        process.stdin.flush()
        opened = json.loads(process.stdout.readline())
        assert opened["schema"] == "pi-arc.sidecar.v1"
        if startup_failure:
            assert opened["ok"] is False
            assert "fixture startup failure" in opened["error"]["message"]
            remaining, diagnostics = process.communicate(timeout=10)
            assert remaining == ""
            assert process.returncode == 1
        else:
            assert opened["ok"] is True
            payload = opened["payload"]
            anchor = payload["anchor"]
            action: dict[str, Any] = {
                "environmentInstanceId": payload["environmentInstanceId"],
                "baseTurn": anchor["turn"],
                "baseObservationDigest": anchor["observationDigest"],
                "actionId": "action1",
                "action": {"name": "ACTION7", "data": {}},
            }
            request.update(requestId="step1", type="submit_action", payload=action)
            remaining, diagnostics = process.communicate(json.dumps(request) + "\n", timeout=10)
            response = json.loads(remaining)
            assert response["ok"] is True
            assert response["payload"]["receipt"]["status"] == "complete"
            assert "step diagnostic" in diagnostics
            assert process.returncode == 0
        for marker in ["game print diagnostic", "native diagnostic", "SDK logger diagnostic"]:
            assert marker in diagnostics
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)
