from __future__ import annotations

import json
import os
import socket
import sys
from typing import cast


def main() -> None:
    line = sys.stdin.readline()
    request = cast(dict[str, object], json.loads(line))
    network_blocked = False
    if request.get("probeNetwork") is True:
        try:
            socket.create_connection(("127.0.0.1", 9))
        except RuntimeError:
            network_blocked = True
    response = {
        "networkBlocked": network_blocked,
        "schema": "pi-arc.meta-plumbing.v1",
        "secretPresent": "PI_ARC_TEST_SECRET" in os.environ,
        "value": request.get("value"),
    }
    sys.stdout.write(json.dumps(response, sort_keys=True, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
