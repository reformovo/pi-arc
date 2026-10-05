"""WP-09 GAME_OVER → RESET → WIN 的离线 Environment fixture。"""


class LifecycleEnvironment:
    """只有 RESET 能从 GAME_OVER 开启下一 Attempt。"""

    def __init__(self, seed: int) -> None:
        self.seed = seed
        self.turn = 0
        self.state = "NOT_FINISHED"

    def reset(self) -> dict[str, object]:
        self.turn = 0
        self.state = "NOT_FINISHED"
        return self._result()

    def step(self, action: str, data: dict[str, object]) -> dict[str, object]:
        del data
        self.turn += 1
        if action == "ACTION1":
            self.state = "GAME_OVER"
        elif action == "RESET":
            self.state = "NOT_FINISHED"
        elif action == "ACTION7":
            self.state = "WIN"
        return self._result()

    def _result(self) -> dict[str, object]:
        return {
            "state": self.state,
            "levelsCompleted": 1 if self.state == "WIN" else 0,
            "winLevels": 1,
            "availableActions": ["RESET"] if self.state == "GAME_OVER" else ["ACTION1", "ACTION7"],
            "frames": [[[self.turn % 16, 1], [2, 3]]],
        }


def create_environment(seed: int) -> LifecycleEnvironment:
    """sidecar 通过 metadata 的入口加载，不通过真实 catalog 下载。"""
    return LifecycleEnvironment(seed)
