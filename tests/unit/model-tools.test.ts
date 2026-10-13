/** 覆盖 provider-neutral 工具的输入限制、artifact-only 读取和知识 safe replay。 */

import { describe, expect, it, vi } from "vitest";
import {
	KnowledgeConflictError,
	ModelToolError,
	ModelToolExecutor,
	RESULT_SCHEMA,
	type ToolAction,
	type ToolCheckpoint,
	type ToolDomainRecord,
	type ToolFrame,
	type ToolKnowledge,
	type ToolPlayResult,
	type ToolRuntimePorts,
} from "../../src/application/model-tools.js";
import { renderVisual, type Visual } from "../../src/domain/game-visual.js";

const anchor = "run-1:env-1:t0:a1:l1:g0:w0";
const visual: Visual = renderVisual([
	[0, 1],
	[2, 3],
]);

function historyRecords(count: number): ToolDomainRecord[] {
	const records: ToolDomainRecord[] = [
		{
			recordType: "turn.commit",
			sequence: 1,
			payload: {
				turn: 0,
				level: 1,
				attempt: 1,
				attemptStatus: "active",
				actionId: null,
				observationDigest: "obs-0",
			},
		},
	];
	for (let turn = 1; turn < count; turn++) {
		const action = { name: "ACTION6", data: { x: 25, y: 7 } };
		const observation = { state: "NOT_FINISHED" };
		const payload = {
			actionId: `a${turn}`,
			action,
			environmentInstanceId: "env",
			baseTurn: turn - 1,
			baseObservationDigest: `obs-${turn - 1}`,
		};
		records.push({ recordType: "action.intent", sequence: records.length + 1, payload });
		records.push({
			recordType: "environment.receipt",
			sequence: records.length + 1,
			payload: { ...payload, turn, observation, status: "complete", receiptDigest: `receipt-${turn}` },
		});
		records.push({
			recordType: "turn.commit",
			sequence: records.length + 1,
			payload: {
				turn,
				observation,
				observationDigest: `obs-${turn}`,
				actionId: `a${turn}`,
				receiptDigest: `receipt-${turn}`,
				level: 1,
				attempt: 1,
				attemptStatus: "ended",
			},
		});
	}
	return records;
}

class FakeTools {
	readonly calls: Array<Record<string, unknown>> = [];
	readonly domain: ToolDomainRecord[] = historyRecords(2);
	readonly frame: ToolFrame = { turn: 1, frame: 0, visualRef: "visual/t000001/f000000.png", visual };
	readonly knowledge = new Map<"guide" | "working", ToolKnowledge>();
	readonly writes = new Map<string, ToolKnowledge>();
	readonly checkpoints = new Map<string, ToolCheckpoint>();
	terminated = false;
	deferCheckpoint = false;
	checkpointPending = false;
	boundaryWaiting = false;
	releaseCheckpoint: (() => void) | null = null;

	play = {
		play: async (input: { invocationId: string; action: ToolAction; retryState: string | null }) => {
			await Promise.resolve();
			this.calls.push(input as unknown as Record<string, unknown>);
			return {
				result: {
					turn: 1,
					attempt: 1,
					level: 1,
					state: "NOT_FINISHED",
					levelsCompleted: 0,
					winLevels: 0,
					availableActions: ["ACTION1", "RESET"],
					frameCount: 1,
					visualRef: this.frame.visualRef,
					observationDigest: "d".repeat(64),
				} satisfies ToolPlayResult,
				image: this.frame.visual,
			};
		},
	};

	evidence = {
		readDomain: async () => this.domain,
		readFrame: async (turn: number, frame: number | null) => {
			await Promise.resolve();
			if (turn !== 1 || (frame !== null && frame !== 0)) throw new Error("frame not found");
			return this.frame;
		},
	};

	knowledgePort = {
		checkpointRequested: async () => this.checkpointPending,
		boundaryPending: async () => this.boundaryWaiting,
		synchronizeLevelArchive: async () => {
			await Promise.resolve();
		},
		read: async (kind: "guide" | "working") => this.knowledge.get(kind) ?? null,
		replace: async (input: {
			kind: "guide" | "working";
			content: string;
			invocationId: string;
			expectedVersion: number;
			anchor: string;
		}) => {
			await Promise.resolve();
			const existing = this.writes.get(input.invocationId);
			if (existing !== undefined) {
				if (existing.content !== input.content || existing.anchor !== input.anchor)
					throw new KnowledgeConflictError("invocation content or anchor conflicts");
				return existing;
			}
			const current = this.knowledge.get(input.kind);
			if ((current?.version ?? 0) !== input.expectedVersion || input.anchor !== anchor)
				throw new KnowledgeConflictError("version conflict");
			const result: ToolKnowledge = {
				kind: input.kind,
				content: input.content,
				version: input.expectedVersion + 1,
				anchor,
				contentDigest: `${input.content.length}`.padStart(64, "0"),
				invocationId: input.invocationId,
			};
			this.knowledge.set(input.kind, result);
			this.writes.set(input.invocationId, result);
			return result;
		},
		saveCheckpoint: async (input: {
			invocationId: string;
			guide: string | null;
			workingMemory: string;
			anchor: string;
		}) => {
			await Promise.resolve();
			const existing = this.checkpoints.get(input.invocationId);
			if (existing !== undefined) return existing;
			if (!this.checkpointPending) throw new ModelToolError("invalid_request", "checkpoint was not requested");
			const save = () => {
				const result: ToolCheckpoint = {
					checkpointId: `checkpoint-${input.invocationId}`,
					anchor: input.anchor,
					guideVersion: input.guide === null ? 0 : 1,
					workingVersion: 1,
					commitDigest: "c".repeat(64),
				};
				this.checkpoints.set(input.invocationId, result);
				this.checkpointPending = false;
				return result;
			};
			if (!this.deferCheckpoint) return save();
			return new Promise<ToolCheckpoint>((resolve) => {
				this.releaseCheckpoint = () => resolve(save());
			});
		},
	};

	digest(value: unknown): string {
		return typeof value === "string" ? `${value.length}`.padStart(64, "0") : "0".repeat(64);
	}

	anchor(): string {
		return anchor;
	}

	isTerminated(): boolean {
		return this.terminated;
	}

	ports(): ToolRuntimePorts {
		return {
			play: this.play,
			evidence: this.evidence,
			knowledge: this.knowledgePort,
			digest: (value) => this.digest(value),
			anchor: () => this.anchor(),
			isTerminated: () => this.isTerminated(),
		};
	}
}

function call(name: string, invocationId: string, args: Record<string, unknown>): Record<string, unknown> {
	return { schema: "pi-arc.tool-call.v1", invocationId, name, args };
}

/** 大部分断言只看 JSON envelope；视觉测试可直接调用 raw.execute 查看 image content。 */
class ToolHarness {
	readonly raw: ModelToolExecutor;
	constructor(ports: ToolRuntimePorts) {
		this.raw = new ModelToolExecutor(ports);
	}
	async execute(value: unknown) {
		return (await this.raw.execute(value)).envelope;
	}
}

describe("model tool contract", () => {
	it("maps model ACTION6 coordinates to the 64-cell Environment grid", async () => {
		const fake = new FakeTools();
		const executor = new ToolHarness(fake.ports());
		const result = await executor.execute(call("play", "play-1", { action: "ACTION6", x: 1023, y: 16 }));
		expect(result).toMatchObject({ schema: RESULT_SCHEMA, ok: true });
		expect(fake.calls[0]).toMatchObject({
			invocationId: "play-1",
			action: { name: "ACTION6", data: { x: 63, y: 1 } },
			retryState: null,
		});
		const carrier = await executor.raw.execute(call("play", "play-image", { action: "ACTION1" }));
		expect(carrier.images).toHaveLength(1);
		expect(carrier.envelope.result).not.toHaveProperty("image");
	});

	it("accepts RESET retry_state and rejects undeclared Action fields", async () => {
		const fake = new FakeTools();
		const executor = new ToolHarness(fake.ports());
		await executor.execute(call("play", "reset-1", { action: "RESET", retry_state: "先检查左侧" }));
		expect(fake.calls[0]).toMatchObject({ action: { name: "RESET", data: {} }, retryState: "先检查左侧" });
		const rejected = await executor.execute(call("play", "bad-1", { action: "ACTION1", x: 1 }));
		expect(rejected).toMatchObject({ ok: false, error: { code: "invalid_request" } });
	});

	it("inspect and read_pixels read archived Visuals only and preserve request order", async () => {
		const fake = new FakeTools();
		const executor = new ToolHarness(fake.ports());
		const inspected = await executor.execute(
			call("inspect", "inspect-1", {
				question: "查看",
				views: [
					{ label: "全图", turn: 1 },
					{ label: "局部", turn: 1, region: { x: 0, y: 0, width: 16, height: 16 } },
				],
			}),
		);
		expect(inspected).toMatchObject({ ok: true, result: { question: "查看" } });
		const imageContent = await executor.raw.execute(
			call("inspect", "inspect-image", { question: "查看", views: [{ label: "全图", turn: 1 }] }),
		);
		expect(imageContent.images).toHaveLength(1);
		expect(imageContent.envelope.result).not.toHaveProperty("image");
		const pixels = await executor.execute(
			call("read_pixels", "pixels-1", {
				question: "采样",
				views: [
					{ label: "a", turn: 1, region: { x: 0, y: 0, width: 32, height: 32 }, rows: 2, columns: 2 },
					{ label: "b", turn: 1, region: { x: 32, y: 32, width: 32, height: 32 }, rows: 1, columns: 1 },
				],
			}),
		);
		expect(pixels).toMatchObject({
			ok: true,
			result: { palette: expect.any(Array), views: [{ label: "a" }, { label: "b" }] },
		});
		const shared = await executor.execute(
			call("read_pixels", "shared-palette", {
				question: "比较颜色索引",
				views: [
					{ label: "left", turn: 1, region: { x: 0, y: 0, width: 16, height: 16 }, rows: 1, columns: 1 },
					{ label: "right", turn: 1, region: { x: 600, y: 0, width: 16, height: 16 }, rows: 1, columns: 1 },
				],
			}),
		);
		expect(shared.result).toMatchObject({
			palette: [expect.any(Array), expect.any(Array)],
			views: [{ rows: ["0"] }, { rows: ["1"] }],
		});
	});

	it("history ignores runtime transcript and supports attempts/events limits", async () => {
		const fake = new FakeTools();
		const executor = new ToolHarness(fake.ports());
		const events = await executor.execute(call("history", "history-1", { view: "events", limit: 2 }));
		expect(events).toMatchObject({ ok: true, result: { view: "events", truncated: false } });
		const attempts = await executor.execute(call("history", "history-2", { view: "attempts" }));
		expect(attempts).toMatchObject({ ok: true, result: { attempts: [{ level: 1, attempt: 1, status: "ended" }] } });
		const limited = await executor.execute(call("history", "history-3", { view: "events", limit: 1 }));
		expect(limited.result).toMatchObject({ truncated: true, actualStartTurn: 1, actualEndTurn: 1 });
		const empty = await executor.execute(call("history", "history-4", { view: "events", start_turn: 9 }));
		expect(empty.result).toMatchObject({ events: [], actualStartTurn: null, actualEndTurn: null, truncated: false });
	});

	it("history follows VISTA latest-default with validated visual actions", async () => {
		const fake = new FakeTools();
		fake.domain.splice(0, fake.domain.length, ...historyRecords(5));
		const executor = new ToolHarness(fake.ports());
		const defaultRange = await executor.execute(call("history", "p2-default", { view: "events", limit: 2 }));
		expect(defaultRange.result).toMatchObject({
			events: [
				{ turn: 3, actionId: "a3" },
				{ turn: 4, actionId: "a4" },
			],
			actualStartTurn: 3,
			actualEndTurn: 4,
			truncated: true,
		});
		// Pinned VISTA controller.py:1143-1146 takes the latest events when no range is given.
		const returned = defaultRange.result?.events;
		if (!Array.isArray(returned)) throw new Error("Missing default events");
		const turns = returned.map((event) => {
			if (event === null || typeof event !== "object" || Array.isArray(event)) throw new Error("Invalid event");
			return event.turn;
		});
		expect(turns).toEqual([3, 4]);
		const ranged = await executor.execute(
			call("history", "p2-ranged", { view: "events", start_turn: 2, end_turn: 4, limit: 2 }),
		);
		expect(ranged.result).toMatchObject({ actualStartTurn: 2, actualEndTurn: 3, truncated: true });
		const events = ranged.result?.events;
		if (!Array.isArray(events)) throw new Error("Missing events");
		for (const event of events)
			expect(event).toHaveProperty("action", {
				name: "ACTION6",
				data: { x: 408, y: 120 },
				coordinateSpace: "visual_1024",
				coordinateRepresentation: "canonical_replay_equivalent",
			});
		expect(fake.calls).toEqual([]);
	});

	it.each([
		"intent",
		"receipt",
		"digest",
		"action",
		"observation",
		"coordinates",
		"missing base",
		"wrong base",
		"duplicate intent",
		"duplicate receipt",
		"duplicate base commit",
		"missing base digest",
		"invalid base type",
	])("history refuses incomplete action proof: %s", async (fault) => {
		const fake = new FakeTools();
		let records = historyRecords(2);
		if (fault === "intent" || fault === "receipt")
			records = records.filter(
				(record) => record.recordType !== (fault === "intent" ? "action.intent" : "environment.receipt"),
			);
		records = records.map((record) => {
			const payload = { ...record.payload };
			if (fault === "digest" && record.recordType === "turn.commit") delete payload.receiptDigest;
			if (record.recordType === "environment.receipt") {
				if (fault === "action") payload.action = { name: "RESET", data: {} };
				if (fault === "observation") payload.observation = { state: "WIN" };
			}
			if (["action.intent", "environment.receipt"].includes(record.recordType)) {
				if (fault === "coordinates") payload.action = { name: "ACTION6", data: { x: 64, y: 0 } };
				if (fault === "missing base") {
					delete payload.baseTurn;
					delete payload.environmentInstanceId;
				}
				if (fault === "wrong base") payload.baseTurn = 17;
				if (fault === "missing base digest") delete payload.baseObservationDigest;
				if (fault === "invalid base type") payload.baseTurn = "0";
			}
			return { ...record, payload };
		});
		if (fault.startsWith("duplicate")) {
			const kind =
				fault === "duplicate intent"
					? "action.intent"
					: fault === "duplicate receipt"
						? "environment.receipt"
						: "turn.commit";
			const duplicate = records.find((record) => record.recordType === kind);
			if (!duplicate) throw new Error("Missing fixture proof");
			records.push({ ...duplicate });
		}
		fake.domain.splice(0, fake.domain.length, ...records);
		const result = await new ToolHarness(fake.ports()).execute(
			call("history", `bad-${fault}`, { view: "events", start_turn: 1, end_turn: 1, limit: 1 }),
		);
		expect(result).toMatchObject({ ok: false, error: { code: "storage_failure" } });
		expect(result.result).toBeUndefined();
		expect(fake.calls).toEqual([]);
	});

	it("history keeps a long ledger bounded and projects only requested latest events", async () => {
		const fake = new FakeTools();
		fake.domain.splice(0, fake.domain.length, ...historyRecords(2001));
		const result = await new ToolHarness(fake.ports()).execute(
			call("history", "long-history", { view: "events", limit: 128 }),
		);
		expect(result).toMatchObject({
			ok: true,
			result: { actualStartTurn: 1873, actualEndTurn: 2000, truncated: true },
		});
		expect(result.result?.events).toHaveLength(128);
		expect(fake.calls).toEqual([]);
		expect(fake.domain).toHaveLength(6001);
	});

	it("history strips RESET author state and cannot promote pending intents", async () => {
		const fake = new FakeTools();
		const records = historyRecords(2).map((record) =>
			record.recordType === "action.intent" || record.recordType === "environment.receipt"
				? {
						...record,
						payload: { ...record.payload, action: { name: "RESET", data: {}, retryState: "private note" } },
					}
				: record,
		);
		records.push({
			recordType: "action.intent",
			sequence: records.length + 1,
			payload: { actionId: "pending", action: { name: "ACTION7", data: {} } },
		});
		fake.domain.splice(0, fake.domain.length, ...records);
		const before = structuredClone(fake.domain);
		const result = await new ToolHarness(fake.ports()).execute(call("history", "reset-history", { view: "events" }));
		expect(result.result?.events).toMatchObject([
			{ turn: 0, action: null },
			{ turn: 1, action: { name: "RESET", data: {} } },
		]);
		expect(JSON.stringify(result)).not.toContain("private note");
		expect(JSON.stringify(result)).not.toContain("pending");
		expect(fake.domain).toEqual(before);
		expect(fake.calls).toEqual([]);
	});

	it("history limits the number of Attempt summaries after grouping", async () => {
		const fake = new FakeTools();
		fake.domain.splice(0, fake.domain.length);
		for (let turn = 0; turn < 6; turn++) {
			fake.domain.push({
				recordType: "turn.commit",
				sequence: turn + 1,
				payload: {
					turn,
					level: turn < 4 ? 1 : 2,
					attempt: turn < 2 || turn >= 4 ? 1 : 2,
					attemptStatus: turn === 1 || turn === 3 ? "ended" : "active",
				},
			});
		}
		const executor = new ToolHarness(fake.ports());
		const limited = await executor.execute(call("history", "p2-attempt-limit", { view: "attempts", limit: 2 }));
		expect(limited.result).toEqual({
			view: "attempts",
			attempts: [
				{ level: 1, attempt: 2, firstTurn: 2, lastTurn: 3, status: "ended" },
				{ level: 2, attempt: 1, firstTurn: 4, lastTurn: 5, status: "active" },
			],
			actualStartTurn: 2,
			actualEndTurn: 5,
			truncated: true,
		});
		const all = await executor.execute(call("history", "p2-attempt-all", { view: "attempts", limit: 6 }));
		expect(all.result?.attempts).toHaveLength(3);
		expect(all.result).toMatchObject({ truncated: false, actualEndTurn: 5 });
	});

	it("GUIDE/WORKING writes require non-empty bounded content and safe replay", async () => {
		const fake = new FakeTools();
		const executor = new ToolHarness(fake.ports());
		const first = await executor.execute(call("write_guide", "note-1", { content: "固定边界" }));
		const replay = await executor.execute(call("write_guide", "note-1", { content: "固定边界" }));
		expect(replay).toEqual(first);
		const empty = await executor.execute(call("write_working", "note-2", { content: "" }));
		expect(empty).toMatchObject({ ok: false, error: { code: "invalid_request" } });
		const conflict = await executor.execute(call("write_guide", "note-1", { content: "第二个版本" }));
		expect(conflict).toMatchObject({ ok: false, error: { code: "version_conflict" } });
	});

	it("checkpoint gates other tools until commit and same invocation replays", async () => {
		const fake = new FakeTools();
		fake.deferCheckpoint = true;
		fake.checkpointPending = true;
		const executor = new ToolHarness(fake.ports());
		const checkpoint = executor.execute(
			call("save_compact_checkpoint", "checkpoint-1", { guide: null, working_memory: "继续观察" }),
		);
		await vi.waitFor(() => expect(fake.releaseCheckpoint).not.toBeNull());
		const blocked = await executor.execute(call("read_working", "blocked-1", {}));
		expect(blocked).toMatchObject({ ok: false, error: { code: "checkpoint_in_progress" } });
		fake.releaseCheckpoint?.();
		const committed = await checkpoint;
		expect(committed).toMatchObject({ ok: true, result: { checkpointId: "checkpoint-checkpoint-1" } });
		const replay = await executor.execute(
			call("save_compact_checkpoint", "checkpoint-1", { guide: null, working_memory: "继续观察" }),
		);
		expect(replay).toEqual(committed);
	});

	it("unrequested checkpoint and pending boundary refuse effects without invoking play", async () => {
		const fake = new FakeTools();
		const executor = new ToolHarness(fake.ports());
		expect(
			await executor.execute(
				call("save_compact_checkpoint", "unrequested", { guide: null, working_memory: "继续" }),
			),
		).toMatchObject({ ok: false, error: { code: "invalid_request" } });
		fake.boundaryWaiting = true;
		expect(await executor.execute(call("play", "blocked-play", { action: "ACTION1" }))).toMatchObject({
			ok: false,
			error: { code: "observation_required" },
		});
		expect(fake.calls).toHaveLength(0);
		expect(await executor.execute(call("read_guide", "boundary-read", {}))).toMatchObject({ ok: true });
	});

	it("read-only tools remain auditable after terminal, writes and play are rejected", async () => {
		const fake = new FakeTools();
		fake.terminated = true;
		const executor = new ToolHarness(fake.ports());
		expect(await executor.execute(call("history", "terminal-history", { view: "events" }))).toMatchObject({
			ok: true,
		});
		expect(await executor.execute(call("play", "terminal-play", { action: "ACTION1" }))).toMatchObject({
			ok: false,
			error: { code: "terminal" },
		});
		expect(await executor.execute(call("write_guide", "terminal-write", { content: "禁止" }))).toMatchObject({
			ok: false,
			error: { code: "terminal" },
		});
	});

	it("enforces view, question, sample and coordinate limits without truncating", async () => {
		const fake = new FakeTools();
		const executor = new ToolHarness(fake.ports());
		const tooMany = await executor.execute(
			call("inspect", "too-many", {
				question: "q",
				views: Array.from({ length: 17 }, () => ({ label: "x", turn: 1 })),
			}),
		);
		expect(tooMany).toMatchObject({ ok: false, error: { code: "invalid_request" } });
		const tooLong = await executor.execute(call("history", "too-long", { view: "events", limit: 129 }));
		expect(tooLong).toMatchObject({ ok: false, error: { code: "invalid_request" } });
		const invalidRegion = await executor.execute(
			call("read_pixels", "bad-region", {
				question: "q",
				views: [{ label: "x", turn: 1, region: { x: 1020, y: 0, width: 8, height: 1 }, rows: 1, columns: 1 }],
			}),
		);
		expect(invalidRegion).toMatchObject({ ok: false, error: { code: "invalid_request" } });
	});

	it("rejects malformed calls and every tool's undeclared or out-of-range fields", async () => {
		const fake = new FakeTools();
		const executor = new ToolHarness(fake.ports());
		const cases: Array<[string, Record<string, unknown>]> = [
			["play", { action: "ACTION6", x: 1024, y: 0 }],
			["play", { action: "ACTION6", x: 1 }],
			["play", { action: "RESET", retry_state: "" }],
			["play", { action: "ACTION1", retry_state: "extra" }],
			["inspect", { question: "q", views: [] }],
			["inspect", { question: "q", views: [{ label: "x", turn: 1, frame: -1 }] }],
			["inspect", { question: "q", views: [{ label: "x", turn: 1, extra: 1 }] }],
			["inspect", { question: "q", views: [{ label: "x", turn: 1, region: { x: 0, y: 0, width: 0, height: 1 } }] }],
			["read_pixels", { question: "q", views: [] }],
			[
				"read_pixels",
				{
					question: "q",
					views: [{ label: "x", turn: 1, region: { x: 0, y: 0, width: 1, height: 1 }, rows: 65, columns: 64 }],
				},
			],
			[
				"read_pixels",
				{
					question: "q",
					views: [{ label: "x", turn: 1, region: { x: 0, y: 0, width: 1, height: 1 }, rows: 0, columns: 1 }],
				},
			],
			["history", { view: "other" }],
			["history", { view: "events", start_turn: 2, end_turn: 1 }],
			["history", { view: "events", limit: 0 }],
			["read_guide", { extra: true }],
			["read_working", { extra: true }],
			["write_guide", { content: "" }],
			["write_working", { content: "x".repeat(16_385) }],
			["save_compact_checkpoint", { guide: 1, working_memory: "x" }],
			["save_compact_checkpoint", { guide: null, working_memory: "" }],
		];
		for (const [name, args] of cases) {
			const result = await executor.execute(call(name, `invalid-${name}-${JSON.stringify(args).length}`, args));
			expect(result, `${name} ${JSON.stringify(args).slice(0, 80)}`).toMatchObject({
				ok: false,
				error: { code: "invalid_request" },
			});
		}
		for (const malformed of [
			null,
			{},
			{ schema: "wrong", invocationId: "bad", name: "history", args: {} },
			call("unknown", "bad", {}),
		]) {
			expect(await executor.execute(malformed)).toMatchObject({ ok: false, error: { code: "invalid_request" } });
		}
		expect(fake.calls).toHaveLength(0);
	});
});
