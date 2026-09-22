from __future__ import annotations

import socket

import pytest


def test_network_sentinel_rejects_a_deliberate_connection() -> None:
    with pytest.raises(RuntimeError, match="network disabled"):
        socket.create_connection(("127.0.0.1", 9))
