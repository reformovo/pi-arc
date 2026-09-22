import { describe, expect, it } from "vitest";
import { PROJECT_NAME, SPEC_BASELINE } from "../../src/protocol/project-meta.js";

describe("project metadata", () => {
	it("identifies the accepted skeleton baseline", () => {
		expect(PROJECT_NAME).toBe("pi-arc");
		expect(SPEC_BASELINE).toBe("pi-arc-v1-2026-09-22");
	});
});
