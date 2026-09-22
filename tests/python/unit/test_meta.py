from pi_arc_sidecar.meta import PROJECT_NAME, SPEC_BASELINE


def test_project_metadata() -> None:
    assert PROJECT_NAME == "pi-arc"
    assert SPEC_BASELINE == "pi-arc-v1-2026-09-22"
