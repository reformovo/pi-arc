from __future__ import annotations

import socket
from collections.abc import Iterator
from typing import NoReturn

import pytest


def _blocked_network(*_args: object, **_kwargs: object) -> NoReturn:
    raise RuntimeError("external network disabled by pi-arc test sentinel")


@pytest.fixture(autouse=True)
def block_external_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(socket, "create_connection", _blocked_network)
    monkeypatch.setattr(socket.socket, "connect", _blocked_network)
    yield
