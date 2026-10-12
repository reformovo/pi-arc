import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
	FT09_NOTE_REVIEW,
	NOTE_POLICY_ADDENDUM,
	offlineNotePolicyReport,
	selectNotePolicyPrompt,
} from "../../scripts/lib/note-policy-experiment.mjs";

describe("offline author note strategy", () => {
	it("keeps baseline bytes and makes the new strategy explicit", () => {
		const baseline = "Baseline task\nwith trailing whitespace  \n";
		expect(selectNotePolicyPrompt(baseline, "baseline")).toBe(baseline);
		expect(selectNotePolicyPrompt(baseline, "notes-v1")).toBe(`${baseline}\n\n${NOTE_POLICY_ADDENDUM}`);
		expect(NOTE_POLICY_ADDENDUM).toContain("not verbatim VISTA alignment");
		expect(() => Reflect.apply(selectNotePolicyPrompt, null, [baseline, "auto"])).toThrow(
			"Unknown offline note strategy",
		);
	});

	it("covers contradiction, contamination and lifecycle gates without per-action writes", () => {
		for (const requirement of [
			"do not write after every play",
			"Level/palette scope",
			"explicit withdrawals",
			"clean, contaminated, or unknown",
			"starting state, actions, actual observation",
			"stale GUIDE claims and their counterevidence in retry_state",
			"do not assert the reset state until the committed result",
			"do not carry old WORKING state",
			"use only save_compact_checkpoint",
			"null only if it remains consistent",
			"do not divide them by 16",
			"without replaying committed actions",
			"host does not derive or certify game rules",
		])
			expect(NOTE_POLICY_ADDENDUM).toContain(requirement);
	});

	it("reuses four historical pairs without fabricating a semantic improvement score", async () => {
		const report = offlineNotePolicyReport();
		expect(report).toMatchObject({
			kind: "offline_manual_review",
			providerRequests: 0,
			semanticImprovementMeasured: false,
		});
		expect(report.criteria).toHaveLength(4);
		expect(report.annotations).toHaveLength(4);
		expect(report.annotations.some((pair) => pair.judgments.includes("unknown"))).toBe(true);
		for (const pair of FT09_NOTE_REVIEW) {
			expect(pair.judgments).toHaveLength(report.criteria.length);
			const file = pair.evidence.split("#")[0];
			if (!file) throw new Error("Missing evidence path");
			expect(await readFile(file, "utf8")).toContain("Turn");
		}
		expect(report.unmeasured).toContain("refutation_update_latency");
		expect(report.annotations[3]?.reason).toContain("already repaired");
	});
});
