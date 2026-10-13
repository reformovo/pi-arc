/** P3 test-only candidate shapes: no production integration or VISTA execution. */
import { describe, expect, it } from "vitest";
import {
	candidateAttemptSummary,
	candidateHistoryAction,
	type ValidatedHistoryEntry,
} from "../support/vista-alignment-candidates.js";

const scope = { level: 5, levelStartTurn: 50 };
const entry = (turn: number, attempt: number, name: string, state = "NOT_FINISHED"): ValidatedHistoryEntry => ({
	turn,
	level: 5,
	attempt,
	action: name === "entry" ? null : { name, data: {} },
	observation: { state },
});

// Synthetic committed-state fixtures, not a puzzle solution or a semantic trial ledger.
const sequence = [
	entry(50, 1, "entry"),
	entry(51, 1, "ACTION1"),
	entry(52, 1, "ACTION1", "GAME_OVER"),
	entry(53, 2, "RESET"),
	entry(54, 2, "ACTION1"),
];

describe("P3 offline candidate contracts", () => {
	it("keeps old Attempt outcome across RESET and excludes RESET from game_actions", () => {
		expect(candidateAttemptSummary(sequence, scope)).toEqual({
			view: "attempts",
			level: 5,
			level_start_turn: 50,
			total_attempts: 2,
			truncated: false,
			attempts: [
				{ attempt: 1, start: "level_entry", start_turn: 50, end_turn: 52, outcome: "GAME_OVER", game_actions: 2 },
				{ attempt: 2, start: "reset", start_turn: 53, end_turn: 54, outcome: "NOT_FINISHED", game_actions: 1 },
			],
		});
		expect(candidateAttemptSummary(sequence, scope, 1)).toMatchObject({
			total_attempts: 2,
			truncated: true,
			attempts: [{ attempt: 2 }],
		});
	});

	it("retains early Attempt summary after more than 128 actions without copying action details", () => {
		const long = [...sequence];
		for (let turn = 55; turn <= 200; turn++) long.push(entry(turn, 2, "ACTION1"));
		const summary = candidateAttemptSummary(long, scope);
		expect(summary.attempts).toHaveLength(2);
		expect(summary.attempts[0]).toMatchObject({ outcome: "GAME_OVER", game_actions: 2 });
		expect(summary.attempts[1]).toMatchObject({ game_actions: 147, end_turn: 200 });
		expect(JSON.stringify(summary)).not.toContain('"action"');
	});

	it("rejects incomplete, mixed-Level and truncated-seed inputs instead of inventing counts", () => {
		expect(() => candidateAttemptSummary(sequence.slice(1), scope)).toThrow("Level entry anchor");
		expect(() => candidateAttemptSummary(sequence.slice(3), scope)).toThrow("Level entry anchor");
		expect(() =>
			candidateAttemptSummary([sequence[0] ?? entry(50, 1, "entry"), entry(52, 1, "ACTION1")], scope),
		).toThrow("Incomplete");
		expect(() =>
			candidateAttemptSummary([entry(50, 1, "entry"), { ...entry(51, 1, "ACTION1"), level: 6 }], scope),
		).toThrow("scope");
		expect(() => candidateAttemptSummary([], scope)).toThrow("scope");
		expect(() => candidateAttemptSummary(sequence, scope, 0)).toThrow("limit");
		expect(() => candidateAttemptSummary([entry(50, 1, "entry"), entry(51, 2, "ACTION1")], scope)).toThrow(
			"without RESET",
		);
	});

	it("does not include internal/author fields in RESET or noncoordinate action candidates", () => {
		const reset = {
			...entry(53, 2, "RESET"),
			action: { name: "RESET", data: {}, retryState: "private author text", internal: "not public" },
		};
		expect(candidateHistoryAction(reset)).toEqual({ name: "RESET", data: {} });
		expect(candidateHistoryAction(entry(51, 1, "ACTION1"))).toEqual({ name: "ACTION1", data: {} });
		expect(() => candidateHistoryAction(entry(51, 1, "OTHER"))).toThrow("name");
		expect(() =>
			candidateHistoryAction({ ...entry(51, 1, "ACTION6"), action: { name: "ACTION6", data: { x: 25, y: 7 } } }),
		).toThrow("visual1024");
	});
});
