"""sidecar contract 测试使用的最小、确定性 Environment code fixture。"""


class FixtureEnvironment:
    """只返回小型 Raw Frame，用于验证 receipt 和 action 去重。"""

    def __init__(self, seed: int) -> None:
        self.seed = seed
        self.steps = 0

    def reset(self) -> dict[str, object]:
        self.steps = 0
        return self._result("NOT_FINISHED")

    def step(self, action: str, data: dict[str, object]) -> dict[str, object]:
        del data
        self.steps += 1
        state = "WIN" if action == "ACTION7" else "NOT_FINISHED"
        return self._result(state)

    def _result(self, state: str) -> dict[str, object]:
        return {
            "state": state,
            "levelsCompleted": self.steps,
            "winLevels": 1 if state == "WIN" else 0,
            "availableActions": ["RESET", "ACTION1", "ACTION6", "ACTION7"],
            "frames": [[[self.steps % 16, 1], [2, 3]]],
        }


def create_environment(seed: int) -> FixtureEnvironment:
    """返回 fixture 环境；seed 被保留在对象中以证明启动参数已传入。"""

    return FixtureEnvironment(seed)
