/** Offline content-quality fixtures: concise authored notes, not a semantic scorer or transcript summary. */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/adapters/artifact-store.js";
import { ModelToolExecutor, TOOL_SCHEMA } from "../../src/application/model-tools.js";
import type { Turn } from "../../src/application/run-controller.js";
import { type KnowledgeIo, KnowledgeStore } from "../../src/composition/knowledge-store.js";
import { RuntimeKnowledgeBridge } from "../../src/composition/runtime-knowledge.js";
import { mapAction6Point } from "../../src/domain/game-visual.js";
import { canonicalJson, type JsonValue } from "../../src/protocol/canonical-json.js";

const at = "2026-09-24T00:00:00Z";
const guide = "Verified: ACTION6 selects the tile at (x,y). Hypothesis: blue tiles open the gate; untested.";
const levelOneTask = "Task: reach the level-1 gate. Next: select (2,3), predict gate opens.";
const levelTwoTask = "Task: reach the level-2 gate. Unresolved: blue or amber switch? Next: test blue at (4,5).";
const retryTask = "Task: level-2 gate after RESET. Rejected: amber route. Next: select blue (4,5), predict gate opens.";
const checkpointTask =
	"Task: level-2 gate. Unresolved: blue switch latch duration. Next: select (6,5), predict gate stays open.";
const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(value: JsonValue): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

async function fixture() {
	const root = await mkdtemp(path.join(tmpdir(), "pi-arc-boundary-quality-"));
	roots.push(root);
	const artifacts = new ArtifactStore(root);
	let current: Turn = {
		turn: 0,
		level: 1,
		attempt: 1,
		attemptStatus: "active",
		actionId: null,
		observation: { state: "NOT_FINISHED", levelsCompleted: 0, winLevels: 2, availableActions: ["ACTION6"] },
		observationDigest: "",
	};
	current.observationDigest = digest(current.observation);
	const anchor = () => `run:env:t${current.turn}:a${current.attempt}:l${current.level}:${current.observationDigest}`;
	const reopen = (io?: KnowledgeIo) => {
		const reopenedArtifacts = new ArtifactStore(root);
		const knowledge = new KnowledgeStore(root, reopenedArtifacts, anchor, () => at, io);
		return {
			artifacts: reopenedArtifacts,
			knowledge,
			bridge: new RuntimeKnowledgeBridge(reopenedArtifacts, knowledge),
		};
	};
	await artifacts.appendDomain("run.binding", at, { runId: "run", environmentInstanceId: "env" });
	await artifacts.appendDomain("turn.commit", at, {
		...current,
		receiptDigest: null,
		retryState: null,
		boundaryPending: false,
	});
	const { knowledge, bridge } = reopen();
	const author = async (kind: "guide" | "working", content: string, invocationId: string) =>
		knowledge.replace({
			kind,
			content,
			invocationId,
			expectedVersion: (await knowledge.read(kind))?.version ?? 0,
			anchor: anchor(),
		});
	const commit = async (
		actionId: string,
		action: { name: "ACTION6" | "RESET"; data: Record<string, JsonValue> },
		levelsCompleted: number,
		retryState: string | null = null,
	) => {
		const base = current;
		const observation = { ...base.observation, levelsCompleted };
		const receipt = {
			actionId,
			status: "complete",
			environmentInstanceId: "env",
			baseTurn: base.turn,
			baseObservationDigest: base.observationDigest,
			action,
			turn: base.turn + 1,
			observation,
			frames: [[[0]]],
			resultState: observation.state,
		};
		await artifacts.appendDomain("action.intent", at, {
			actionId,
			invocationId: actionId,
			environmentInstanceId: "env",
			baseTurn: base.turn,
			baseObservationDigest: base.observationDigest,
			action,
			retryState,
		});
		const receiptDigest = digest(receipt);
		await artifacts.appendDomain("environment.receipt", at, { ...receipt, receiptDigest });
		current = {
			turn: receipt.turn,
			level: levelsCompleted + 1,
			attempt:
				levelsCompleted !== base.observation.levelsCompleted
					? 1
					: action.name === "RESET"
						? base.attempt + 1
						: base.attempt,
			attemptStatus: "active",
			actionId,
			observation,
			observationDigest: digest(observation),
		};
		await artifacts.appendDomain("turn.commit", at, {
			...current,
			receiptDigest,
			retryState,
			boundaryPending: retryState !== null,
			frameCount: 1,
		});
		return current;
	};
	return {
		root,
		artifacts,
		knowledge,
		bridge,
		reopen,
		anchor,
		author,
		commit,
		authority: () => ({ turn: current, termination: null, finish: () => Promise.reject(new Error("unused")) }),
	};
}

function decode(prompt: string) {
	const lines = prompt.split("\n");
	expect(lines[0]).toBe("Environment record:");
	expect(lines[3]).toBe("Agent-authored notes:");
	return {
		environment: JSON.parse(lines[1] ?? "") as {
			current_observation: Turn["observation"];
			last_action_result: {
				turn: number;
				level: number;
				attempt: number;
				attemptStatus: string;
				actionId: string;
				action: JsonValue;
				observation: Turn["observation"];
				observationDigest: string;
			};
			current_level_history: {
				turn: number;
				level: number;
				attempt: number;
				attemptStatus: string;
				actionId: string;
				action: JsonValue;
				observation: Turn["observation"];
				observationDigest: string;
			}[];
		},
		notes: JSON.parse(lines[4] ?? "") as { guide: string; working_memory: string },
	};
}

function projected(x: number, y: number) {
	return {
		name: "ACTION6",
		data: { x: x * 16 + 8, y: y * 16 + 8 },
		coordinateSpace: "visual_1024",
		coordinateRepresentation: "canonical_replay_equivalent",
	};
}

describe("offline boundary recovery content quality", () => {
	it("feeds recovered visual coordinates through the real play parser without double mapping", async () => {
		const f = await fixture();
		await f.commit("archived-action", { name: "ACTION6", data: { x: 25, y: 7 } }, 0);
		const envelope = decode(await f.bridge.recoveryEnvelope(f.authority())).environment;
		const action = envelope.last_action_result.action as { name: string; data: { x: number; y: number } };
		let native: unknown;
		const executor = new ModelToolExecutor({
			play: {
				play: ({ action: mapped }) => {
					native = mapped;
					return Promise.resolve({
						result: {
							turn: 2,
							attempt: 1,
							level: 1,
							state: "NOT_FINISHED",
							levelsCompleted: 0,
							winLevels: 2,
							availableActions: ["ACTION6"],
							frameCount: 1,
							visualRef: "visuals/t000002/f000000.png",
							observationDigest: "test",
						},
						image: { width: 1, height: 1, rgb: Uint8Array.from([0, 0, 0]) },
					});
				},
			},
			evidence: { readDomain: () => f.artifacts.readDomain(), readFrame: () => Promise.reject(new Error("unused")) },
			knowledge: f.knowledge,
			digest,
			anchor: f.anchor,
			isTerminated: () => false,
		});
		const records = await f.artifacts.readDomain();
		const result = await executor.execute({
			schema: TOOL_SCHEMA,
			invocationId: "new-planned-action",
			name: "play",
			args: { action: action.name, x: action.data.x, y: action.data.y },
		});
		expect(result.envelope.ok).toBe(true);
		expect(native).toEqual({ name: "ACTION6", data: { x: 25, y: 7 } });
		expect(await f.artifacts.readDomain()).toEqual(records);
	});
	it.each([
		[0, 0],
		[15, 16],
		[25, 7],
		[63, 63],
	])(
		"projects native (%i,%i) identically before and after checkpoint without altering audit Evidence",
		async (x, y) => {
			const f = await fixture();
			await f.commit("same-action-id", { name: "ACTION6", data: { x, y } }, 0);
			const beforeRecords = await f.artifacts.readDomain();
			const before = await f.bridge.recoveryEnvelope(f.authority());
			const recovered = decode(before).environment;
			expect(recovered.last_action_result.action).toEqual(projected(x, y));
			expect(recovered.current_level_history[1]?.action).toEqual(projected(x, y));
			expect(mapAction6Point(projected(x, y).data.x, projected(x, y).data.y)).toEqual({ x, y });
			expect(before).toContain("not the original model input");
			expect(before).toContain("do not divide by 16");
			// Re-reading the same actionId is a projection, not an Action submission or archive write.
			expect(await f.reopen().bridge.recoveryEnvelope(f.authority())).toBe(before);
			expect(await f.artifacts.readDomain()).toEqual(beforeRecords);
			await f.knowledge.requestCheckpoint("compact-coordinate", f.anchor());
			await f.knowledge.saveCheckpoint({
				invocationId: "save-coordinate",
				guide: null,
				workingMemory: "continue",
				anchor: f.anchor(),
			});
			const boundary = await f.reopen().bridge.prepareBoundary(f.authority());
			if (boundary === null) throw new Error("checkpoint boundary missing");
			expect(decode(boundary.prompt).environment).toEqual(recovered);
			expect(await f.reopen().bridge.prepareBoundary(f.authority())).toEqual(boundary);
			expect(
				(await f.artifacts.readDomain()).filter((record) =>
					["action.intent", "environment.receipt", "turn.commit"].includes(record.recordType),
				),
			).toEqual(
				beforeRecords.filter((record) =>
					["action.intent", "environment.receipt", "turn.commit"].includes(record.recordType),
				),
			);
		},
	);

	it.each([
		{},
		{ x: 1 },
		{ x: -1, y: 0 },
		{ x: 64, y: 0 },
		{ x: 0, y: 64 },
		{ x: 1.5, y: 0 },
		{ x: 0, y: 1.5 },
		{ x: "25", y: 7 },
		{ x: null, y: 0 },
	])("fails closed even when intent and receipt agree on malformed native data %j", async (data) => {
		const f = await fixture();
		await f.commit("bad-coordinate", { name: "ACTION6", data: { x: 0, y: 0 } }, 0);
		// Floats cannot enter the canonical archive at all; inject a malformed reader result
		// to also prove recovery never projects them, even with matching intent/receipt.
		const records = (await f.artifacts.readDomain()).map((record) =>
			record.recordType === "action.intent" || record.recordType === "environment.receipt"
				? { ...record, payload: { ...record.payload, action: { name: "ACTION6", data } } }
				: record,
		);
		const artifacts = { readDomain: async () => records } as unknown as ArtifactStore;
		await expect(new RuntimeKnowledgeBridge(artifacts, f.knowledge).recoveryEnvelope(f.authority())).rejects.toThrow(
			/native coordinates|canonical JSON only accepts safe integer/,
		);
	});

	it.each([
		"missing digest",
		"missing receipt",
		"missing intent",
		"different action",
		"different observation",
		"different base anchor",
	])("fails closed for a committed action with %s", async (fault) => {
		const f = await fixture();
		await f.commit("tile-1", { name: "ACTION6", data: { x: 2, y: 3 } }, 0);
		let records = await f.artifacts.readDomain();
		if (fault === "missing receipt")
			records = records.filter((record) => record.recordType !== "environment.receipt");
		if (fault === "missing intent") records = records.filter((record) => record.recordType !== "action.intent");
		records = records.map((record) => {
			const payload = { ...record.payload };
			if (fault === "missing digest" && record.recordType === "turn.commit" && payload.actionId !== null)
				delete payload.receiptDigest;
			if (record.recordType === "environment.receipt") {
				if (fault === "different action") payload.action = { name: "RESET", data: {} };
				if (fault === "different observation") payload.observation = { state: "WIN" };
				if (fault === "different base anchor") payload.baseObservationDigest = "other";
			}
			return { ...record, payload };
		});
		const invalidArtifacts = { readDomain: async () => records } as unknown as ArtifactStore;
		const bridge = new RuntimeKnowledgeBridge(invalidArtifacts, f.knowledge);
		await expect(bridge.recoveryEnvelope(f.authority())).rejects.toThrow(/recovery Action/);
	});

	it("restores exact committed notes and action progress across levels, RESET and interrupted checkpoint delivery", async () => {
		const f = await fixture();
		await f.author("guide", guide, "guide-1");
		await f.author("working", levelOneTask, "working-1");
		const transition = await f.commit("level-transition", { name: "ACTION6", data: { x: 2, y: 3 } }, 1);
		// Reading active WORKING first durably archives the previous Level, then returns the clear projection.
		expect(await f.reopen().knowledge.read("working")).toBeNull();
		expect(await readFile(path.join(f.root, "knowledge/level-archive/turn-000000.md"), "utf8")).toBe(levelOneTask);
		const levelPrompt = decode(await f.reopen().bridge.recoveryEnvelope(f.authority()));
		expect(levelPrompt.notes).toEqual({ guide, working_memory: "" });
		expect(levelPrompt.environment.current_level_history.map((entry) => entry.turn)).toEqual([1]);
		expect(levelPrompt.environment.last_action_result).toMatchObject({
			action: projected(2, 3),
			observation: transition.observation,
		});
		expect(levelPrompt.environment.current_observation.levelsCompleted).toBe(1);
		await f.author("working", levelTwoTask, "working-2");
		await f.commit("blue-probe", { name: "ACTION6", data: { x: 4, y: 5 } }, 1);
		const reset = await f.commit("reset-2", { name: "RESET", data: {} }, 1, retryTask);
		const firstReset = await f.bridge.prepareBoundary(f.authority());
		if (firstReset === null) throw new Error("RESET boundary missing");
		// Process/context interruption after preparation but before delivery acknowledgement.
		const restartedReset = f.reopen();
		expect(await restartedReset.bridge.prepareBoundary(f.authority())).toEqual(firstReset);
		const restoredReset = decode(firstReset.prompt);
		expect(restoredReset.notes).toEqual({ guide, working_memory: retryTask });
		expect(restoredReset.environment.last_action_result).toEqual({
			turn: 3,
			level: 2,
			attempt: 2,
			attemptStatus: "active",
			actionId: "reset-2",
			action: { name: "RESET", data: {} },
			observation: reset.observation,
			observationDigest: reset.observationDigest,
		});
		expect(restoredReset.environment.current_level_history.map((entry) => entry.action)).toEqual([
			projected(2, 3),
			projected(4, 5),
			{ name: "RESET", data: {} },
		]);
		expect(restoredReset.environment.current_level_history.map((entry) => entry.turn)).toEqual([1, 2, 3]);
		expect(
			restoredReset.environment.current_level_history.map(({ level, attempt, attemptStatus }) => ({
				level,
				attempt,
				attemptStatus,
			})),
		).toEqual([
			{ level: 2, attempt: 1, attemptStatus: "active" },
			{ level: 2, attempt: 1, attemptStatus: "active" },
			{ level: 2, attempt: 2, attemptStatus: "active" },
		]);
		expect(firstReset.prompt).not.toContain(levelOneTask);
		expect(firstReset.prompt).not.toContain(levelTwoTask);
		await restartedReset.bridge.acknowledgeBoundary(firstReset.boundaryId);
		await restartedReset.knowledge.requestCheckpoint("compact-1", f.anchor());
		await restartedReset.knowledge.saveCheckpoint({
			invocationId: "save-1",
			guide: null,
			workingMemory: checkpointTask,
			anchor: f.anchor(),
		});
		const firstCheckpoint = await restartedReset.bridge.prepareBoundary(f.authority());
		if (firstCheckpoint === null) throw new Error("checkpoint boundary missing");
		const fresh = f.reopen();
		expect(await fresh.bridge.prepareBoundary(f.authority())).toEqual(firstCheckpoint);
		const restoredCheckpoint = decode(firstCheckpoint.prompt);
		expect(restoredCheckpoint.notes).toEqual({ guide, working_memory: checkpointTask });
		expect(restoredCheckpoint.environment).toEqual(restoredReset.environment);
		expect(firstCheckpoint.prompt).not.toContain(retryTask);
		await fresh.bridge.acknowledgeBoundary(firstCheckpoint.boundaryId);
		expect(await fresh.bridge.prepareBoundary(f.authority())).toBeNull();
		expect((await f.artifacts.readDomain()).filter((record) => record.recordType === "turn.commit")).toHaveLength(4);
		expect((await fresh.knowledge.read("guide"))?.content).toBe(guide);
	});

	it("does not promote an uncommitted action or partial checkpoint note into recovery", async () => {
		const f = await fixture();
		await f.author("guide", guide, "guide-1");
		await f.author("working", levelOneTask, "working-1");
		const committed = await f.commit("tile-1", { name: "ACTION6", data: { x: 2, y: 3 } }, 0);
		const recordsBefore = await f.artifacts.readDomain();
		await f.artifacts.appendDomain("action.intent", at, {
			actionId: "pending-reset",
			action: { name: "RESET", data: {} },
			retryState: "UNCOMMITTED retry hypothesis",
		});
		const before = decode(await f.reopen().bridge.recoveryEnvelope(f.authority()));
		expect(before.notes).toEqual({ guide, working_memory: levelOneTask });
		expect(before.environment.last_action_result).toMatchObject({
			actionId: "tile-1",
			action: projected(2, 3),
			observation: committed.observation,
		});
		expect(before.environment.current_level_history.map((entry) => entry.actionId)).toEqual([null, "tile-1"]);
		// This bridge is not controller reconciliation: the pending intent is audit-only, never projected as a result.
		await f.knowledge.requestCheckpoint("compact-partial", f.anchor());
		const faultyIo: KnowledgeIo = {
			mkdir: async (directory) => {
				await mkdir(directory, { recursive: true });
			},
			readFile: (file) => readFile(file, "utf8"),
			writeFile: async (file, content) => {
				if (file.includes("-working.md")) throw new Error("interrupted snapshot publication");
				await writeFile(file, content, "utf8");
			},
			rename,
		};
		const checkpoint = {
			invocationId: "save-partial",
			guide: "UNCOMMITTED replacement rule",
			workingMemory: checkpointTask,
			anchor: f.anchor(),
		};
		await expect(f.reopen(faultyIo).knowledge.saveCheckpoint(checkpoint)).rejects.toThrow(
			"interrupted snapshot publication",
		);
		const fresh = f.reopen();
		expect((await fresh.knowledge.read("guide"))?.content).toBe(guide);
		expect((await fresh.knowledge.read("working"))?.content).toBe(levelOneTask);
		expect(await fresh.bridge.pendingCheckpoint()).toBe(true);
		expect(await fresh.bridge.prepareBoundary(f.authority())).toBeNull();
		expect(await fresh.bridge.recoveryEnvelope(f.authority())).toContain("Call save_compact_checkpoint now");
		await fresh.knowledge.saveCheckpoint(checkpoint);
		const delivered = await fresh.bridge.prepareBoundary(f.authority());
		if (delivered === null) throw new Error("committed checkpoint boundary missing");
		expect(decode(delivered.prompt).notes).toEqual({ guide: checkpoint.guide, working_memory: checkpointTask });
		expect(decode(delivered.prompt).environment).toEqual(before.environment);
		expect(delivered.prompt).not.toContain("pending-reset");
		expect(delivered.prompt).not.toContain("UNCOMMITTED retry hypothesis");
		expect((await f.artifacts.readDomain()).filter((record) => record.recordType === "turn.commit")).toEqual(
			recordsBefore.filter((record) => record.recordType === "turn.commit"),
		);
	});
});
