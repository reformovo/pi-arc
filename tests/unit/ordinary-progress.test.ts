import { describe, expect, it } from "vitest";
import type { RuntimeRecord } from "../../src/adapters/artifact-store.js";
import {
	ORDINARY_TOOL_ATTEMPT_LIMIT,
	OrdinaryProgressGuard,
	type RuntimeAuthority,
} from "../../src/composition/pi-runtime.js";

function fixture() {
	const records: RuntimeRecord[] = [];
	const authority = { turn: { turn: 7, observationDigest: "observation", attempt: 2 } } as RuntimeAuthority;
	const options = {
		now: () => "2026-10-10T00:00:00Z",
		evidence: {
			readRuntime: () => Promise.resolve(records),
			appendRuntime: (
				eventType: RuntimeRecord["eventType"],
				recordedAt: string,
				payload: RuntimeRecord["payload"],
			) => {
				const record: RuntimeRecord = {
					schema: "pi-arc.runtime-record.v1",
					sequence: records.length + 1,
					eventType,
					recordedAt,
					payload,
				};
				records.push(record);
				return Promise.resolve(record);
			},
		},
	};
	return { records, authority, options, guard: new OrdinaryProgressGuard(options, authority) };
}

describe("ordinary no-progress inventory", () => {
	it("restores the attempt allowance, admitted arguments gate, and progression stage", async () => {
		const f = fixture();
		await f.guard.restore();
		await f.guard.begin(1);
		await f.guard.response(Array.from({ length: ORDINARY_TOOL_ATTEMPT_LIMIT + 1 }, (_, i) => `call-${i}`));
		const restored = new OrdinaryProgressGuard(f.options, f.authority);
		await restored.restore();
		expect(restored.stage).toBe(1);
		expect(restored.exhausted()).toBe(true);
		expect(restored.admits("call-15")).toBe(true);
		expect(restored.admits("call-16")).toBe(false);
		expect(restored.stops("call-15")).toBe(true);
		await restored.begin(2);
		expect(restored.exhausted()).toBe(false);
	});
	it("does not mistake runtime/notebook writes or repeated provider ids for committed progress", async () => {
		const f = fixture();
		await f.guard.restore();
		for (let i = 0; i < ORDINARY_TOOL_ATTEMPT_LIMIT; i++) await f.guard.response(["reused-id"]);
		await f.guard.begin(0);
		expect(f.guard.exhausted()).toBe(true);
		f.authority.turn.turn += 1;
		f.authority.turn.observationDigest = "new-observation";
		expect(f.guard.exhausted()).toBe(false);
		await f.guard.response(["next"]);
		const restored = new OrdinaryProgressGuard(f.options, f.authority);
		await restored.restore();
		expect(restored.exhausted()).toBe(false);
		expect(restored.stage).toBe(0);
	});
});
