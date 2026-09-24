/** 使用离线 fake Environment 逐段检验 Run controller 的持久化与恢复。 */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type ArtifactManifest, ArtifactStore } from "../../src/adapters/artifact-store.js";
import { canonicalJsonDigest } from "../../src/adapters/sha256.js";
import {
	ActionRejectedError,
	type ControllerEnvironment,
	type ControllerPorts,
	type GameAction,
	type Observation,
	ReceiptCommitError,
	RunController,
	UnknownActionOutcomeError,
} from "../../src/application/run-controller.js";

const at = "2026-09-23T00:00:00Z";
const runId = "run-controller-test";
const action: GameAction = { name: "ACTION1", data: {} };

function manifest(): ArtifactManifest {
	return {
		schema: "pi-arc.run-manifest.v1",
		runId,
		game: { id: "fixture", treeDigest: "a".repeat(64) },
		model: { provider: "fake", modelId: "offline" },
		runtime: { piAgentCore: "0.86.0" },
		coordinates: 1024,
		seed: 42,
	};
}

/** Fake 只实现 wire authority，不接触真实 Python、provider 或网络。 */
class FakeEnvironment implements ControllerEnvironment {
	readonly instanceId = "fake-env-1";
	turn = 0;
	observation: Observation = {
		state: "NOT_FINISHED",
		levelsCompleted: 0,
		winLevels: 0,
		availableActions: ["ACTION1", "ACTION7", "RESET"],
	};
	readonly receipts = new Map<string, Record<string, unknown>>();
	submitCount = 0;
	lookupCount = 0;
	mode: "complete" | "before_accept" | "pending" | "unavailable" | "corrupt" | "deferred" = "complete";
	nextState: Observation["state"] = "NOT_FINISHED";
	advanceLevel = false;
	releaseReply: (() => void) | null = null;

	async open(): Promise<Record<string, unknown>> {
		await Promise.resolve();
		return {
			environmentInstanceId: this.instanceId,
			anchor: this.anchor(),
			observation: this.observation,
			frames: [
				[
					[0, 1],
					[2, 3],
				],
			],
		};
	}

	anchor(): Record<string, unknown> {
		return {
			environmentInstanceId: this.instanceId,
			turn: this.turn,
			observationDigest: canonicalJsonDigest(this.observation),
			terminalState: this.observation.state,
		};
	}

	async request(
		type: "get_anchor" | "submit_action" | "lookup_action",
		payload: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		// 模拟跨进程异步 response，让 admission/取消竞态可被测试。
		await Promise.resolve();
		if (this.mode === "unavailable") throw new Error("instance unavailable");
		if (payload.environmentInstanceId !== this.instanceId) throw new Error("instance mismatch");
		if (type === "get_anchor") return { anchor: this.anchor() };
		const id = payload.actionId as string;
		if (type === "lookup_action") {
			this.lookupCount += 1;
			const existing = this.receipts.get(id);
			if (existing !== undefined) return { receipt: existing };
			if (payload.baseTurn !== this.turn || payload.baseObservationDigest !== canonicalJsonDigest(this.observation))
				throw new Error("anchor conflict");
			return {
				receipt: {
					actionId: id,
					status: "not_accepted",
					environmentInstanceId: this.instanceId,
					baseTurn: this.turn,
					baseObservationDigest: canonicalJsonDigest(this.observation),
				},
			};
		}
		this.submitCount += 1;
		const existing = this.receipts.get(id);
		if (existing !== undefined) return { receipt: existing };
		if (this.mode === "before_accept") throw new Error("disconnected before accept");
		const baseTurn = this.turn;
		const baseObservationDigest = canonicalJsonDigest(this.observation);
		const base = {
			actionId: id,
			status: "pending",
			environmentInstanceId: this.instanceId,
			baseTurn,
			baseObservationDigest,
			action: payload.action,
		};
		if (this.mode === "pending") {
			this.receipts.set(id, base);
			throw new Error("disconnected after accept");
		}
		const sentAction = payload.action as GameAction;
		this.turn += 1;
		this.observation = {
			state: this.nextState,
			levelsCompleted: this.advanceLevel ? 1 : 0,
			winLevels: this.nextState === "WIN" ? 1 : 0,
			availableActions: ["ACTION1", "ACTION7", "RESET"],
		};
		const complete = {
			...base,
			status: "complete",
			turn: this.turn,
			observation: this.observation,
			frames: [
				[
					[this.turn, 1],
					[2, 3],
				],
			],
			resultState: this.observation.state,
			action: sentAction,
		};
		const receipt = {
			...complete,
			receiptDigest: this.mode === "corrupt" ? "0".repeat(64) : canonicalJsonDigest(complete),
		};
		this.receipts.set(id, receipt);
		if (this.mode === "deferred") {
			return new Promise((resolve) => {
				this.releaseReply = () => resolve({ receipt });
			});
		}
		return { receipt };
	}
}

async function setup(): Promise<{
	root: string;
	store: ArtifactStore;
	environment: FakeEnvironment;
	ports: ControllerPorts;
	controller: RunController;
}> {
	const root = await mkdtemp(path.join(tmpdir(), "pi-arc-controller-"));
	const store = new ArtifactStore(root);
	const environment = new FakeEnvironment();
	const ports: ControllerPorts = {
		artifacts: store,
		environment,
		visuals: {
			publish: async (turn, frame) =>
				`visuals/t${String(turn).padStart(6, "0")}/f${String(frame).padStart(6, "0")}.png`,
		},
		now: () => at,
		digest: canonicalJsonDigest,
	};
	const controller = await RunController.start(
		{ manifest: manifest(), sessionId: "session-1", laneId: "lane-1" },
		ports,
	);
	return { root, store, environment, ports, controller };
}

function play(actionId = "action-1", value = action) {
	return { actionId, invocationId: `invocation-${actionId}`, action: value };
}

describe("Run lifecycle and effect protocol", () => {
	it("T-RUN-001: persists initial Turn 0 with all Frames and binding before admitting Action", async () => {
		const { controller, store, root } = await setup();
		expect(controller.turn).toMatchObject({ turn: 0, level: 1, attempt: 1, actionId: null });
		expect((await store.readDomain()).map((entry) => entry.recordType)).toEqual(["run.binding", "turn.commit"]);
		expect(JSON.parse(await readFile(path.join(root, "frames/t000000/f000000.json"), "utf8"))).toMatchObject({
			turn: 0,
			frame: 0,
			actionId: null,
		});
	});

	it("T-EFFECT-001: invalid Action is rejected before intent and Environment submission", async () => {
		const { controller, environment, store } = await setup();
		await expect(controller.play(play("invalid", { name: "ACTION6", data: { x: 64, y: 0 } }))).rejects.toBeInstanceOf(
			ActionRejectedError,
		);
		expect(environment.submitCount).toBe(0);
		expect(controller.turn.turn).toBe(0);
		expect((await store.readDomain()).map((entry) => entry.recordType)).toEqual([
			"run.binding",
			"turn.commit",
			"tool.rejection",
		]);
	});

	it("T-EFFECT-002: intent survives a negative acknowledgement and permits one first submission", async () => {
		const { controller, environment, store, ports } = await setup();
		await store.appendDomain("action.intent", at, {
			actionId: "recovered",
			invocationId: "invocation-recovered",
			environmentInstanceId: environment.instanceId,
			baseTurn: 0,
			baseObservationDigest: canonicalJsonDigest(controller.turn.observation),
			action,
			retryState: null,
		});
		const recovered = await RunController.recover(runId, ports);
		expect(recovered.turn.turn).toBe(1);
		expect(environment.lookupCount).toBe(1);
		expect(environment.submitCount).toBe(1);
	});

	it("T-UNKNOWN-001: accepted but incomplete Action fails closed without a second submit", async () => {
		const { controller, environment, store } = await setup();
		environment.mode = "pending";
		await expect(controller.play(play())).rejects.toBeInstanceOf(UnknownActionOutcomeError);
		expect(environment.submitCount).toBe(1);
		expect(controller.termination).toMatchObject({
			terminationReason: "unknown_action_outcome",
			outcomeClass: "unknown_outcome",
		});
		expect((await store.readDomain()).map((entry) => entry.recordType)).toContain("terminal.intent");
		await expect(controller.play(play("later"))).rejects.toBeInstanceOf(ActionRejectedError);
	});

	it("T-EFFECT-003: complete receipt already in ledger commits without querying Environment", async () => {
		const { controller, environment, store, ports } = await setup();
		const intent = {
			actionId: "saved",
			invocationId: "invocation-saved",
			environmentInstanceId: environment.instanceId,
			baseTurn: 0,
			baseObservationDigest: controller.turn.observationDigest,
			action,
			retryState: null,
		};
		await store.appendDomain("action.intent", at, intent);
		const response = await environment.request("submit_action", { ...intent });
		const receipt = response.receipt as Record<string, unknown>;
		await store.appendDomain("environment.receipt", at, receipt as Record<string, never>);
		environment.mode = "unavailable";
		const recovered = await RunController.recover(runId, ports);
		expect(recovered.turn.turn).toBe(1);
		expect(environment.lookupCount).toBe(0);
		expect((await store.readDomain()).map((entry) => entry.recordType)).toContain("turn.commit");
	});

	it("T-EFFECT-004: already committed Turn is recovered without resubmitting Action", async () => {
		const { controller, environment, ports } = await setup();
		await controller.play(play());
		const recovered = await RunController.recover(runId, ports);
		expect(recovered.turn.turn).toBe(1);
		expect(environment.submitCount).toBe(1);
		expect(environment.lookupCount).toBe(0);
	});

	it("T-LIFECYCLE-001: GAME_OVER ends Attempt; only RESET starts the next Attempt", async () => {
		const { controller, environment } = await setup();
		environment.nextState = "GAME_OVER";
		const failed = await controller.play(play());
		expect(failed).toMatchObject({ turn: 1, level: 1, attempt: 1, attemptStatus: "ended" });
		await expect(controller.play(play("bad-after-game-over"))).rejects.toBeInstanceOf(ActionRejectedError);
		environment.nextState = "NOT_FINISHED";
		const reset = await controller.play({
			...play("reset", { name: "RESET", data: {} }),
			retryState: "下次先试右边",
		});
		expect(reset).toMatchObject({ turn: 2, level: 1, attempt: 2, attemptStatus: "active" });
	});

	it("T-LIFECYCLE-002: Level progress stays in Run; WIN writes one terminal", async () => {
		const { controller, environment, store } = await setup();
		environment.advanceLevel = true;
		const next = await controller.play(play());
		expect(next).toMatchObject({ turn: 1, level: 2, attempt: 1, attemptStatus: "active" });
		environment.nextState = "WIN";
		const win = await controller.play(play("win", { name: "ACTION7", data: {} }));
		expect(win.observation.state).toBe("WIN");
		expect(controller.termination).toMatchObject({
			outcomeClass: "win",
			terminationReason: "WIN",
			lastCommittedTurn: 2,
		});
		await expect(controller.play(play("after-win"))).rejects.toBeInstanceOf(ActionRejectedError);
		expect((await store.readDomain()).filter((entry) => entry.recordType === "terminal.intent")).toHaveLength(1);
	});

	it("T-CANCEL-001: cancellation without pending Action preserves last Turn", async () => {
		const { controller, store } = await setup();
		expect(await controller.cancel()).toMatchObject({ terminationReason: "cancelled", lastCommittedTurn: 0 });
		expect(await controller.cancel()).toMatchObject({ terminationReason: "cancelled" });
		expect((await store.readDomain()).filter((entry) => entry.recordType === "terminal.intent")).toHaveLength(1);
	});

	it("T-CANCEL-002: pending Action must be classified before cancellation", async () => {
		const { controller, environment, store } = await setup();
		environment.mode = "pending";
		await expect(controller.play(play())).rejects.toBeInstanceOf(UnknownActionOutcomeError);
		expect(await controller.cancel()).toMatchObject({ terminationReason: "unknown_action_outcome" });
		const before = await store.readTerminal();
		await store.appendLateEvidence(at, { actionId: "action-1", receivedLater: true });
		expect(await store.readTerminal()).toEqual(before);
	});

	it("T-EFFECT-005/006: no pending Action loses Environment as known failure; pending loss is unknown", async () => {
		const idle = await setup();
		idle.environment.mode = "unavailable";
		expect((await RunController.recover(runId, idle.ports)).termination).toMatchObject({
			terminationReason: "environment_lost",
		});
		const active = await setup();
		await active.store.appendDomain("action.intent", at, {
			actionId: "lost",
			invocationId: "invocation-lost",
			environmentInstanceId: active.environment.instanceId,
			baseTurn: 0,
			baseObservationDigest: active.controller.turn.observationDigest,
			action,
			retryState: null,
		});
		active.environment.mode = "unavailable";
		await expect(RunController.recover(runId, active.ports)).rejects.toBeInstanceOf(UnknownActionOutcomeError);
		expect(await active.store.readTerminal()).toMatchObject({ terminationReason: "unknown_action_outcome" });
	});

	it("rejects duplicate IDs, premature RESET, misplaced retry_state and invalid ACTION6", async () => {
		const { controller, environment, store } = await setup();
		await expect(controller.play(play("early-reset", { name: "RESET", data: {} }))).rejects.toBeInstanceOf(
			ActionRejectedError,
		);
		await expect(controller.play({ ...play("bad-retry"), retryState: "not a reset" })).rejects.toBeInstanceOf(
			ActionRejectedError,
		);
		await expect(controller.play(play("bad-six", { name: "ACTION6", data: { x: 1 } }))).rejects.toBeInstanceOf(
			ActionRejectedError,
		);
		await controller.play(play("once"));
		await expect(controller.play(play("once"))).rejects.toBeInstanceOf(ActionRejectedError);
		expect(environment.submitCount).toBe(1);
		expect((await store.readDomain()).filter((entry) => entry.recordType === "tool.rejection")).toHaveLength(4);
	});

	it("RESET keeps retry_state and boundary flag in the same committed Turn", async () => {
		const { controller, environment, store } = await setup();
		environment.nextState = "GAME_OVER";
		await controller.play(play());
		await expect(controller.play(play("missing-reset-state", { name: "RESET", data: {} }))).rejects.toBeInstanceOf(
			ActionRejectedError,
		);
		environment.nextState = "NOT_FINISHED";
		await controller.play({ ...play("valid-reset", { name: "RESET", data: {} }), retryState: "保留推理" });
		const commits = (await store.readDomain()).filter((entry) => entry.recordType === "turn.commit");
		expect(commits.at(-1)?.payload).toMatchObject({ attempt: 2, retryState: "保留推理", boundaryPending: true });
	});

	it("a tampered complete receipt never becomes a Turn commit", async () => {
		const { controller, environment, store } = await setup();
		environment.mode = "corrupt";
		await expect(controller.play(play())).rejects.toBeInstanceOf(UnknownActionOutcomeError);
		expect(controller.turn.turn).toBe(0);
		expect((await store.readDomain()).filter((entry) => entry.recordType === "turn.commit")).toHaveLength(1);
		expect(await store.readTerminal()).toMatchObject({ outcomeClass: "unknown_outcome" });
	});

	it("terminal intent is completed after crash, while existing terminal needs no sidecar", async () => {
		const unfinished = await setup();
		await unfinished.store.appendDomain("terminal.intent", at, { reason: "model_failure", lastCommittedTurn: 0 });
		unfinished.environment.mode = "unavailable";
		const completed = await RunController.recover(runId, unfinished.ports);
		expect(completed.termination).toMatchObject({ terminationReason: "model_failure", outcomeClass: "non_success" });
		const again = await RunController.recover(runId, unfinished.ports);
		expect(again.termination).toEqual(completed.termination);
		expect(unfinished.environment.lookupCount).toBe(0);
	});

	it("committed WIN survives failure before terminal intent, without Environment recovery", async () => {
		const { controller, environment, ports, store } = await setup();
		environment.nextState = "WIN";
		const original = ports.artifacts;
		ports.artifacts = new Proxy(original, {
			get(target, property) {
				if (property === "appendDomain")
					return (type: string, time: string, payload: Record<string, unknown>) => {
						if (type === "terminal.intent") throw new Error("crash before terminal intent");
						return target.appendDomain(type as "turn.commit", time, payload as Record<string, never>);
					};
				const value = Reflect.get(target, property) as unknown;
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		await expect(controller.play(play("winning", { name: "ACTION7", data: {} }))).rejects.toBeInstanceOf(
			ReceiptCommitError,
		);
		expect((await store.readDomain()).at(-1)?.recordType).toBe("turn.commit");
		ports.artifacts = original;
		environment.mode = "unavailable";
		const recovered = await RunController.recover(runId, ports);
		expect(recovered.termination).toMatchObject({ terminationReason: "WIN", outcomeClass: "win" });
	});

	it("known terminal classes remain distinct and WIN cannot be invented", async () => {
		const known = await setup();
		await expect(known.controller.finish("WIN")).rejects.toThrow("committed authority");
		expect(await known.controller.finish("model_no_progress")).toMatchObject({ outcomeClass: "non_success" });
		const corrupt = await setup();
		expect(await corrupt.controller.finish("evidence_corrupt")).toMatchObject({ outcomeClass: "audit_failure" });
		const failed = await setup();
		expect(await failed.controller.finish("controller_failure")).toMatchObject({ outcomeClass: "audit_failure" });
	});

	it("late Environment result after cancellation is Evidence only; concurrent play is denied", async () => {
		const { controller, environment, store } = await setup();
		environment.mode = "deferred";
		const pending = controller.play(play());
		await expect(controller.play(play("concurrent"))).rejects.toBeInstanceOf(ActionRejectedError);
		// 等到 fake 的 Environment 已执行，但 response 尚未交付。
		await vi.waitFor(() => expect(environment.releaseReply).not.toBeNull());
		environment.mode = "unavailable";
		const terminal = await controller.cancel();
		expect(terminal.terminationReason).toBe("unknown_action_outcome");
		environment.releaseReply?.();
		await expect(pending).rejects.toBeInstanceOf(UnknownActionOutcomeError);
		expect(controller.turn.turn).toBe(0);
		expect((await store.readDomain()).map((entry) => entry.recordType)).toContain("post_terminal.evidence");
		expect(await store.readTerminal()).toEqual(terminal);
	});

	it("cancellation commits a queryable receipt before writing cancelled terminal", async () => {
		const { controller, environment, store } = await setup();
		environment.mode = "deferred";
		const pending = controller.play(play());
		await vi.waitFor(() => expect(environment.releaseReply).not.toBeNull());
		const terminal = await controller.cancel();
		expect(terminal).toMatchObject({ terminationReason: "cancelled", lastCommittedTurn: 1 });
		environment.releaseReply?.();
		await expect(pending).rejects.toBeInstanceOf(UnknownActionOutcomeError);
		const types = (await store.readDomain()).map((entry) => entry.recordType);
		expect(types.indexOf("turn.commit", 2)).toBeLessThan(types.indexOf("terminal.intent"));
	});

	it("storage error after durable intent never admits a second Action", async () => {
		const { controller, environment, ports, store } = await setup();
		const original = ports.artifacts;
		ports.artifacts = new Proxy(original, {
			get(target, property) {
				if (property === "appendDomain")
					return async (type: string, time: string, payload: Record<string, unknown>) => {
						const result = await target.appendDomain(
							type as "turn.commit",
							time,
							payload as Record<string, never>,
						);
						if (type === "action.intent") throw new Error("storage acknowledgement lost");
						return result;
					};
				const value = Reflect.get(target, property) as unknown;
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		await expect(controller.play(play("uncertain-write"))).rejects.toThrow("storage acknowledgement lost");
		expect((await store.readDomain()).at(-1)?.recordType).toBe("action.intent");
		await expect(controller.play(play("second"))).rejects.toBeInstanceOf(ActionRejectedError);
		expect(environment.submitCount).toBe(0);
		ports.artifacts = original;
		const recovered = await RunController.recover(runId, ports);
		expect(recovered.turn.turn).toBe(1);
		expect(environment.submitCount).toBe(1);
	});

	it("complete Environment receipt plus local frame fault remains recoverable, not Unknown Outcome", async () => {
		const { controller, environment, ports, store } = await setup();
		const original = ports.artifacts;
		ports.artifacts = new Proxy(original, {
			get(target, property) {
				if (property === "writeRawFrame")
					return (frame: { turn: number }) => {
						if (frame.turn === 1) throw new Error("frame disk unavailable");
						return target.writeRawFrame(frame as Parameters<typeof target.writeRawFrame>[0]);
					};
				const value = Reflect.get(target, property) as unknown;
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		await expect(controller.play(play("known-receipt"))).rejects.toBeInstanceOf(ReceiptCommitError);
		expect(await store.readTerminal()).toBeUndefined();
		await expect(controller.play(play("blocked"))).rejects.toBeInstanceOf(ActionRejectedError);
		ports.artifacts = original;
		const recovered = await RunController.recover(runId, ports);
		expect(recovered.turn.turn).toBe(1);
		expect(environment.submitCount).toBe(1);
	});
});
