from __future__ import annotations

import os
import socket
from typing import NoReturn


def _blocked_network(*_args: object, **_kwargs: object) -> NoReturn:
    raise RuntimeError("external network disabled by pi-arc test sentinel")


if os.environ.get("PI_ARC_BLOCK_NETWORK") == "1":
    socket.create_connection = _blocked_network
    socket.socket.connect = _blocked_network
