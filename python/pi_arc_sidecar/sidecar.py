"""pi-arc 的 Python Environment sidecar。

sidecar 是唯一加载下载 Game Python 的进程。它把 Environment 的权威状态、
完整 Raw Frame 和 receipt 写入自己的小型 cache，再通过 JSONL wire 返回给
TypeScript controller。它不会读取 Pi session、模型凭据或 artifact root。
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import json
import os
import re
import secrets
import socket
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, cast

from .canonical_json import canonical_json, canonical_json_digest

SCHEMA = "pi-arc.sidecar.v1"
ERROR_CODES = {
    "invalid_request",
    "version_mismatch",
    "instance_mismatch",
    "anchor_conflict",
    "action_conflict",
    "unavailable",
    "internal",
}
ACTION_TYPES = {
    "RESET",
    "ACTION1",
    "ACTION2",
    "ACTION3",
    "ACTION4",
    "ACTION5",
    "ACTION6",
    "ACTION7",
}
STATES = {"NOT_PLAYED", "NOT_FINISHED", "GAME_OVER", "WIN"}


class SidecarFault(Exception):
    """把可预期的 controller 错误转换为稳定 wire error。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _record(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SidecarFault("invalid_request", f"{label} must be an object")
    return cast(dict[str, Any], value)


def _string(record: dict[str, Any], key: str, label: str = "payload") -> str:
    value = record.get(key)
    if not isinstance(value, str) or value == "":
        raise SidecarFault("invalid_request", f"{label}.{key} must be a non-empty string")
    return value


def _atomic_write(path: Path, value: object) -> None:
    """用同目录临时文件和 replace 保存 cache，避免留下半条 receipt。"""

    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with open(descriptor, "w", encoding="utf-8", closefd=True) as handle:
            handle.write(canonical_json(value))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def _load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    try:
        with path.open(encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError:
        return default
    except (OSError, json.JSONDecodeError) as error:
        raise SidecarFault("internal", f"sidecar cache is unreadable: {error}") from error
    return _record(value, str(path))


def _safe_environment_root(value: str) -> Path:
    input_root = Path(value)
    if input_root.is_symlink():
        raise SidecarFault("unavailable", "environment root must not be a symlink")
    root = input_root.resolve()
    if not root.is_dir():
        raise SidecarFault("unavailable", "environment root must be a real directory")
    try:
        children = list(root.rglob("*"))
    except OSError as error:
        raise SidecarFault("unavailable", f"environment root cannot be read: {error}") from error
    for child in children:
        if child.is_symlink() or (not child.is_file() and not child.is_dir()):
            raise SidecarFault("unavailable", "environment root contains an unsafe entry")
    return root


def _configure_offline_process() -> None:
    """清理凭据/代理并阻断网络，保证 Game code 只在 offline 边界运行。"""

    for key in list(os.environ):
        if any(
            token in key.upper()
            for token in ("API_KEY", "AUTHORIZATION", "OAUTH", "TOKEN", "SECRET")
        ):
            os.environ.pop(key, None)
        if key.upper() in {"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"}:
            os.environ.pop(key, None)
    os.environ["OPERATION_MODE"] = "offline"
    if os.environ.get("PI_ARC_BLOCK_NETWORK") == "1":

        def blocked(*_args: object, **_kwargs: object) -> None:
            raise RuntimeError("external network disabled by pi-arc sidecar")

        socket.create_connection = blocked
        socket.socket.connect = blocked


def _load_module(root: Path) -> ModuleType:
    metadata_path = root / "metadata.json"
    metadata = _load_json(metadata_path, {})
    entrypoint = metadata.get("entrypoint", "environment.py")
    if (
        not isinstance(entrypoint, str)
        or Path(entrypoint).name != entrypoint
        or not entrypoint.endswith(".py")
    ):
        raise SidecarFault("unavailable", "metadata entrypoint must be a local Python file")
    source = root / entrypoint
    if not source.is_file() or source.is_symlink():
        raise SidecarFault("unavailable", "Environment entrypoint is missing")
    spec = importlib.util.spec_from_file_location("pi_arc_game_environment", source)
    if spec is None or spec.loader is None:
        raise SidecarFault("unavailable", "Environment module cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _frame(value: object) -> list[list[int]]:
    if not isinstance(value, list) or not value:
        raise SidecarFault("internal", "Environment returned no Raw Frame")
    rows = cast(list[object], value)
    if len(rows) > 64:
        raise SidecarFault("internal", "Raw Frame is taller than 64 cells")
    result: list[list[int]] = []
    width: int | None = None
    for row_value in rows:
        if not isinstance(row_value, list) or not row_value:
            raise SidecarFault("internal", "Raw Frame contains an empty row")
        row = cast(list[object], row_value)
        if width is None:
            width = len(row)
            if width > 64:
                raise SidecarFault("internal", "Raw Frame is wider than 64 cells")
        if len(row) != width:
            raise SidecarFault("internal", "Raw Frame is not rectangular")
        converted: list[int] = []
        for pixel in row:
            if not isinstance(pixel, int) or isinstance(pixel, bool) or not 0 <= pixel <= 15:
                raise SidecarFault("internal", "Raw Frame color is outside the ARC palette")
            converted.append(pixel)
        result.append(converted)
    return result


def _frames(value: object) -> list[list[list[int]]]:
    if not isinstance(value, list) or not value:
        raise SidecarFault("internal", "Environment returned no Raw Frame")
    return [_frame(item) for item in cast(list[object], value)]


def _environment_result(value: object) -> tuple[str, int, int, list[list[list[int]]], list[str]]:
    result = _record(value, "Environment result")
    state = result.get("state", "NOT_FINISHED")
    if not isinstance(state, str) or state not in STATES:
        raise SidecarFault("internal", "Environment returned an unknown state")
    levels = result.get("levelsCompleted", 0)
    wins = result.get("winLevels", 0)
    if not isinstance(levels, int) or not isinstance(wins, int) or levels < 0 or wins < 0:
        raise SidecarFault("internal", "Environment returned invalid level counters")
    available = result.get("availableActions", sorted(ACTION_TYPES))
    available_values = cast(list[object], available) if isinstance(available, list) else []
    if not isinstance(available, list) or not all(
        isinstance(item, str) for item in available_values
    ):
        raise SidecarFault("internal", "Environment returned invalid available actions")
    return state, levels, wins, _frames(result.get("frames")), cast(list[str], available_values)


@dataclass
class Environment:
    """把官方 SDK 或测试 Environment 的最小行为投影到 sidecar 契约。"""

    value: Any

    @classmethod
    def load(cls, root: Path, seed: int, cache_root: Path, game_id: str) -> Environment:
        metadata = _load_json(root / "metadata.json", {})
        if "entrypoint" in metadata:
            # `entrypoint` 仅供 committed deterministic fixture 使用；真实 Game
            # metadata 使用官方 SDK 的 game_id/class_name，不经自定义 port 执行。
            module = _load_module(root)
            factory = getattr(module, "create_environment", None)
            if not callable(factory):
                raise SidecarFault(
                    "unavailable", "Environment module must export create_environment"
                )
            try:
                return cls(factory(seed))
            except Exception as error:
                raise SidecarFault(
                    "unavailable", f"Environment initialization failed: {error}"
                ) from error
        metadata_game_id = metadata.get("game_id", metadata.get("gameId"))
        if metadata_game_id != game_id:
            raise SidecarFault("unavailable", "Game metadata identity does not match cache locator")
        try:
            sdk = importlib.import_module("arc_agi")
            arcade = sdk.Arcade(
                operation_mode=sdk.OperationMode.OFFLINE,
                environments_dir=str(root),
                recordings_dir=str(cache_root / "sdk-recordings"),
            )
            wrapper = arcade.make(game_id, seed=seed, save_recording=False)
        except Exception as error:
            raise SidecarFault(
                "unavailable", f"offline ARC SDK could not open Environment: {error}"
            ) from error
        if wrapper is None:
            raise SidecarFault("unavailable", "offline ARC SDK did not find the exact Game")
        return cls(ArcadeEnvironment(wrapper))

    def reset(self) -> object:
        method = getattr(self.value, "reset", None)
        if not callable(method):
            raise SidecarFault("unavailable", "Environment has no reset method")
        return method()

    def step(self, action: str, data: dict[str, Any]) -> object:
        method = getattr(self.value, "step", None)
        if not callable(method):
            raise SidecarFault("unavailable", "Environment has no step method")
        return method(action, data)


class ArcadeEnvironment:
    """把 `arc-agi==0.9.9` 的 public wrapper 投影成 sidecar 内部接口。"""

    def __init__(self, wrapper: Any) -> None:
        self.wrapper = wrapper

    def reset(self) -> dict[str, object]:
        return _arcade_result(self.wrapper.reset())

    def step(self, action: str, data: dict[str, Any]) -> dict[str, object]:
        engine = importlib.import_module("arcengine")
        return _arcade_result(self.wrapper.step(engine.GameAction.from_name(action), data))


def _arcade_result(value: Any) -> dict[str, object]:
    if value is None:
        raise SidecarFault("internal", "ARC SDK returned no Observation")
    state = getattr(value.state, "value", value.state)
    frames = [frame.tolist() for frame in value.frame]
    action_names = {
        0: "RESET",
        1: "ACTION1",
        2: "ACTION2",
        3: "ACTION3",
        4: "ACTION4",
        5: "ACTION5",
        6: "ACTION6",
        7: "ACTION7",
    }
    return {
        "state": state,
        "levelsCompleted": value.levels_completed,
        "winLevels": value.win_levels,
        "availableActions": [
            action_names[item] for item in value.available_actions if item in action_names
        ],
        "frames": frames,
    }


class Sidecar:
    """单实例、串行的 sidecar 状态机。"""

    def __init__(
        self,
        environment_root: Path,
        cache_root: Path,
        game_id: str,
        seed: int,
        source_locator: str = "",
        tree_digest: str = "",
    ) -> None:
        self.instance_id = secrets.token_hex(16)
        self.environment = Environment.load(environment_root, seed, cache_root, game_id)
        self.cache_root = cache_root.resolve()
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self.state_path = self.cache_root / "sidecar-state.json"
        self.game_id = game_id
        self.seed = seed
        self.source_locator = source_locator
        self.tree_digest = tree_digest
        self.turn = 0
        self.observation: dict[str, Any] = {}
        self.observation_digest = "0" * 64
        self.terminal_state = "NOT_PLAYED"
        self.receipts: dict[str, dict[str, Any]] = {}
        self._open()

    def _open(self) -> None:
        state = _load_json(self.state_path, {})
        if state:
            # cache 只用于同一 sidecar 进程的 crash 注入诊断；新进程不会继承
            # environmentInstanceId，因此不能把旧 Environment 当作仍然存活。
            raise SidecarFault("unavailable", "a sidecar cache belongs to another instance")
        state_value = self.environment.reset()
        state, levels, wins, frames, available = _environment_result(state_value)
        self.observation = {
            "state": state,
            "levelsCompleted": levels,
            "winLevels": wins,
            "availableActions": available,
        }
        self.terminal_state = state
        self.observation_digest = canonical_json_digest(self.observation)
        self.receipts = {}
        self._persist(frames, None)

    def _persist(self, frames: list[list[list[int]]], pending: dict[str, Any] | None) -> None:
        state = {
            "environmentInstanceId": self.instance_id,
            "gameId": self.game_id,
            "turn": self.turn,
            "observation": self.observation,
            "observationDigest": self.observation_digest,
            "terminalState": self.terminal_state,
            "frames": frames,
            "pending": pending,
            "receipts": self.receipts,
        }
        _atomic_write(self.state_path, state)

    def _anchor(self) -> dict[str, Any]:
        return {
            "environmentInstanceId": self.instance_id,
            "turn": self.turn,
            "observationDigest": self.observation_digest,
            "terminalState": self.terminal_state,
        }

    def _check_instance(self, payload: dict[str, Any]) -> None:
        if payload.get("environmentInstanceId") != self.instance_id:
            raise SidecarFault(
                "instance_mismatch", "environmentInstanceId does not match this sidecar"
            )

    def _check_anchor(self, payload: dict[str, Any]) -> None:
        if (
            payload.get("baseTurn") != self.turn
            or payload.get("baseObservationDigest") != self.observation_digest
        ):
            raise SidecarFault("anchor_conflict", "base Environment anchor is stale")

    def _receipt(
        self,
        action_id: str,
        action: dict[str, Any],
        status: str,
        frames: list[list[list[int]]] | None,
        base_turn: int,
        base_digest: str,
    ) -> dict[str, Any]:
        result: dict[str, Any] = {
            "actionId": action_id,
            "status": status,
            "environmentInstanceId": self.instance_id,
            "baseTurn": base_turn,
            "baseObservationDigest": base_digest,
            "action": action,
        }
        if status == "complete":
            result.update(
                {
                    "turn": self.turn,
                    "observation": self.observation,
                    "frames": frames or [],
                    "resultState": self.terminal_state,
                }
            )
            result["receiptDigest"] = hashlib.sha256(
                canonical_json(result).encode("utf-8")
            ).hexdigest()
        return result

    def _submit(self, payload: dict[str, Any]) -> dict[str, Any]:
        self._check_instance(payload)
        action_id = _string(payload, "actionId")
        action = _record(payload.get("action"), "payload.action")
        name = _string(action, "name", "payload.action")
        if name not in ACTION_TYPES:
            raise SidecarFault("invalid_request", "payload.action.name is not a known GameAction")
        if set(action) != {"name", "data"}:
            raise SidecarFault("invalid_request", "Action must contain only name and data")
        data_value = action.get("data", {})
        if not isinstance(data_value, dict):
            raise SidecarFault("invalid_request", "payload.action.data must be an object")
        data = cast(dict[str, Any], data_value)
        if name == "RESET" and "retry_state" in data:
            raise SidecarFault("invalid_request", "RESET cannot contain retry_state")
        if name == "ACTION6":
            if set(data) != {"x", "y"}:
                raise SidecarFault("invalid_request", "ACTION6 data must contain exactly x and y")
            for coordinate in ("x", "y"):
                value = data.get(coordinate)
                if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 63:
                    raise SidecarFault(
                        "invalid_request", "ACTION6 coordinates must be integers in 0..63"
                    )
        elif data:
            raise SidecarFault("invalid_request", "simple Action data must be empty")
        existing = self.receipts.get(action_id)
        if existing is not None:
            if (
                existing.get("action") != action
                or existing.get("baseTurn") != payload.get("baseTurn")
                or existing.get("baseObservationDigest") != payload.get("baseObservationDigest")
            ):
                raise SidecarFault(
                    "action_conflict", "actionId was already used with other parameters"
                )
            return existing
        self._check_anchor(payload)
        if name not in self.observation.get("availableActions", []):
            raise SidecarFault("invalid_request", "Action is not available at this Observation")
        base_turn = self.turn
        base_digest = self.observation_digest
        pending = self._receipt(action_id, action, "pending", None, base_turn, base_digest)
        self.receipts[action_id] = pending
        self._persist([], pending)
        if os.environ.get("PI_ARC_SIDECAR_CRASH_AFTER_ACCEPT") == "1":
            os._exit(75)
        try:
            raw = self.environment.reset() if name == "RESET" else self.environment.step(name, data)
            state, levels, wins, frames, available = _environment_result(raw)
        except SidecarFault:
            raise
        except Exception as error:
            raise SidecarFault("internal", f"Environment action failed: {error}") from error
        self.turn += 1
        self.observation = {
            "state": state,
            "levelsCompleted": levels,
            "winLevels": wins,
            "availableActions": available,
        }
        self.terminal_state = state
        self.observation_digest = canonical_json_digest(self.observation)
        complete = self._receipt(action_id, action, "complete", frames, base_turn, base_digest)
        self.receipts[action_id] = complete
        self._persist(frames, None)
        return complete

    def dispatch(self, request_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        if request_type == "open":
            if set(payload) != {"gameId", "sourceLocator", "treeDigest", "seed"}:
                raise SidecarFault(
                    "invalid_request", "open payload contains missing or unknown fields"
                )
            if (
                payload.get("gameId") != self.game_id
                or payload.get("sourceLocator") != self.source_locator
                or payload.get("treeDigest") != self.tree_digest
                or payload.get("seed") != self.seed
            ):
                raise SidecarFault(
                    "anchor_conflict", "open payload does not match the verified Game cache"
                )
            return {
                "environmentInstanceId": self.instance_id,
                "anchor": self._anchor(),
                "observation": self.observation,
                "frames": _frames(_load_json(self.state_path, {}).get("frames")),
            }
        if request_type == "get_anchor":
            self._check_instance(payload)
            return {"anchor": self._anchor()}
        if request_type == "lookup_action":
            self._check_instance(payload)
            action_id = _string(payload, "actionId")
            existing = self.receipts.get(action_id)
            if existing is not None:
                return {"receipt": existing}
            self._check_anchor(payload)
            return {
                "receipt": {
                    "actionId": action_id,
                    "status": "not_accepted",
                    "environmentInstanceId": self.instance_id,
                    "baseTurn": self.turn,
                    "baseObservationDigest": self.observation_digest,
                }
            }
        if request_type == "submit_action":
            return {"receipt": self._submit(payload)}
        if request_type == "close":
            self._check_instance(payload)
            return {"closed": True, "anchor": self._anchor()}
        raise SidecarFault("invalid_request", f"unsupported request type {request_type}")


def _response(
    request: dict[str, Any],
    *,
    payload: dict[str, Any] | None = None,
    error: SidecarFault | None = None,
) -> dict[str, Any]:
    request_id = request.get("requestId", "invalid")
    request_type = request.get("type", "invalid")
    result: dict[str, Any] = {
        "schema": SCHEMA,
        "requestId": request_id,
        "type": request_type,
        "ok": error is None,
    }
    if error is None:
        result["payload"] = payload or {}
    else:
        result["error"] = {
            "code": error.code if error.code in ERROR_CODES else "internal",
            "message": str(error),
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="pi-arc Python Environment sidecar")
    parser.add_argument("--environment-root", required=True)
    parser.add_argument("--cache-root", required=True)
    parser.add_argument("--game-id", required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--source-locator", required=True)
    parser.add_argument("--tree-digest", required=True)
    args = parser.parse_args()
    _configure_offline_process()
    try:
        sidecar = Sidecar(
            _safe_environment_root(args.environment_root),
            Path(args.cache_root),
            args.game_id,
            args.seed,
            args.source_locator,
            args.tree_digest,
        )
    except SidecarFault as error:
        print(
            json.dumps(
                _response({"requestId": "startup", "type": "open"}, error=error), ensure_ascii=False
            ),
            flush=True,
        )
        return 1
    for line in sys.stdin:
        request: dict[str, Any] = {}
        try:
            request = _record(json.loads(line), "request")
            if set(request) != {"schema", "requestId", "type", "payload"}:
                raise SidecarFault(
                    "invalid_request", "request envelope contains missing or unknown fields"
                )
            if request.get("schema") != SCHEMA:
                raise SidecarFault("version_mismatch", "sidecar schema must be pi-arc.sidecar.v1")
            request_id = request.get("requestId")
            request_type = request.get("type")
            if (
                not isinstance(request_id, str)
                or re.fullmatch(r"[A-Za-z0-9._~-]+", request_id) is None
                or not isinstance(request_type, str)
            ):
                raise SidecarFault("invalid_request", "requestId and type are required")
            payload = _record(request.get("payload"), "request.payload")
            output = sidecar.dispatch(request_type, payload)
            print(
                json.dumps(
                    _response(request, payload=output), ensure_ascii=False, separators=(",", ":")
                ),
                flush=True,
            )
        except (SidecarFault, json.JSONDecodeError, TypeError, ValueError) as error:
            fault = (
                error
                if isinstance(error, SidecarFault)
                else SidecarFault("invalid_request", str(error))
            )
            print(
                json.dumps(
                    _response(locals().get("request", {}), error=fault),
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                flush=True,
            )
        except Exception as error:  # pragma: no cover - last-resort process boundary
            print(
                json.dumps(
                    _response(
                        locals().get("request", {}), error=SidecarFault("internal", str(error))
                    ),
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                flush=True,
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
