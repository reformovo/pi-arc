/** 使用公开 faux Models 验证 Pi 顺序工具循环和 ARC 恢复门禁，不接真实模型。 */

import { AgentHarness, MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";
import type { RuntimeRecord } from "../../src/adapters/artifact-store.js";
import { canonicalJsonDigest } from "../../src/adapters/sha256.js";
import { ModelToolExecutor, type ToolRuntimePorts } from "../../src/application/model-tools.js";
import type { RuntimeAuthority } from "../../src/composition/pi-runtime.js";
import { PiArcRuntime, resolveRuntimeModel } from "../../src/composition/pi-runtime.js";
import { PiToolAdapter, type PiToolEvidence } from "../../src/composition/pi-tools.js";

const now = () => "2026-09-24T00:00:00Z";

function harnessFixture() {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const repo = new MemorySessionRepo();
	const records: RuntimeRecord[] = [];
	const evidence: PiToolEvidence = {
		readRuntime: async () => records,
		appendRuntime: (eventType, recordedAt, payload) => {
			const record: RuntimeRecord = {
				schema: "pi-arc.runtime-record.v1",
				sequence: records.length + 1,
				recordedAt,
				eventType,
				payload,
			};
			records.push(record);
			return Promise.resolve(record);
		},
	};
	const turn = {
		turn: 0,
		observation: {
			state: "NOT_FINISHED" as const,
			levelsCompleted: 0,
			winLevels: 0,
			availableActions: ["ACTION1" as const],
		},
		observationDigest: "initial",
		level: 1,
		attempt: 1,
		attemptStatus: "active" as const,
		actionId: null as string | null,
	};
	const authority: RuntimeAuthority = {
		turn,
		get termination() {
			return terminal;
		},
		finish: (reason) => {
			terminal = {
				schema: "pi-arc.terminal.v1",
				runId: "runtime-test",
				outcomeClass: "non_success",
				terminationReason: reason,
				lastCommittedTurn: turn.turn,
				ledgerHead: "test",
				recordedAt: now(),
			};
			return Promise.resolve(terminal);
		},
	};
	let terminal: Awaited<ReturnType<RuntimeAuthority["finish"]>> | null = null;
	let playCount = 0;
	const ports: ToolRuntimePorts = {
		play: {
			play: ({ invocationId }) => {
				playCount += 1;
				turn.turn += 1;
				turn.actionId = invocationId;
				turn.observationDigest = `turn-${turn.turn}`;
				return Promise.resolve({
					result: {
						turn: turn.turn,
						attempt: 1,
						level: 1,
						state: "NOT_FINISHED",
						levelsCompleted: 0,
						winLevels: 0,
						availableActions: ["ACTION1"],
						frameCount: 1,
						visualRef: "visuals/t000001/f000000.png",
						observationDigest: turn.observationDigest,
					},
					image: { width: 1, height: 1, rgb: Uint8Array.from([0, 0, 0]) },
				});
			},
		},
		evidence: {
			readDomain: async () => [],
			readFrame: () => Promise.reject(new Error("unused")),
		},
		knowledge: {
			read: async () => null,
			replace: () => Promise.reject(new Error("unused")),
			saveCheckpoint: () => Promise.reject(new Error("unused")),
			checkpointRequested: async () => false,
			boundaryPending: async () => false,
			synchronizeLevelArchive: async () => {},
		},
		digest: canonicalJsonDigest,
		anchor: () => `${turn.turn}`,
		isTerminated: () => terminal !== null,
	};
	const boundary = { prepare: async () => null, acknowledge: () => Promise.resolve() };
	return {
		faux,
		models,
		repo,
		records,
		evidence,
		authority,
		ports,
		boundary,
		get playCount() {
			return playCount;
		},
	};
}

describe("Pi runtime / faux Models", () => {
	it("executes tools sequentially and rejects every call after the first play in one response", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		fixture.faux.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("play", { action: "ACTION1" }),
					fauxToolCall("history", { view: "events" }),
					fauxToolCall("play", { action: "ACTION1" }),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "Complete the game.",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "Recovered observation",
			boundary: fixture.boundary,
			pendingCheckpoint: async () => false,
		});
		try {
			const result = await runtime.prompt("Initial observation");
			expect(result.kind).toBe("settled");
			expect(fixture.playCount).toBe(1);
			expect(fixture.records.filter((record) => record.eventType === "tool.admitted")).toHaveLength(1);
			const rejected = fixture.records.filter((record) => record.eventType === "tool.rejected");
			expect(rejected.map((record) => record.payload.code)).toEqual([
				"observation_required",
				"observation_required",
			]);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it("does not invoke the provider when ARC recovery or knowledge validation fails", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		await expect(
			PiArcRuntime.attach({
				session,
				models: fixture.models,
				provider: fixture.faux.provider.id,
				modelId: fixture.faux.getModel().id,
				laneId: "main",
				systemPrompt: "test",
				evidence: fixture.evidence,
				now,
				recoverAuthority: async () => fixture.authority,
				validateKnowledge: () => Promise.reject(new Error("anchor mismatch")),
				createExecutor: () => new ModelToolExecutor(fixture.ports),
				buildRecoveryEnvelope: async () => "recovered",
				boundary: fixture.boundary,
				pendingCheckpoint: async () => false,
			}),
		).rejects.toThrow("anchor mismatch");
		expect(fixture.faux.state.callCount).toBe(0);
		await fixture.repo.close(TODO_CONTEXT);
	});

	it("restores the same-response play gate from runtime inventory after restart", async () => {
		const fixture = harnessFixture();
		await fixture.evidence.appendRuntime("tool.admitted", now(), {
			name: "play",
			invocationId: "first-play",
			turnId: "assistant-turn-1",
		});
		const adapter = await PiToolAdapter.create({
			executor: new ModelToolExecutor(fixture.ports),
			evidence: fixture.evidence,
			now,
			isTerminated: () => false,
		});
		const history = adapter.tools().find((tool) => tool.name === "history");
		expect(history?.replay).toBe("safe");
		expect(adapter.tools().find((tool) => tool.name === "play")?.replay).toBe("never");
		const memo = new Map<string, string>();
		await expect(
			history?.execute(
				"later-call",
				{ view: "events" },
				() => {},
				undefined,
				{
					invocationId: "later-invocation",
					operationId: "op-1",
					turnId: "assistant-turn-1",
					getMemo: async (key) => memo.get(key),
					setMemo: (key, value) => {
						if (typeof value === "string") memo.set(key, value);
						return Promise.resolve();
					},
				},
				TODO_CONTEXT,
			),
		).rejects.toThrow("observation_required");
		expect(fixture.playCount).toBe(0);
	});

	it("ends a nonterminal run after one continuation and one fresh recovery context", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		fixture.faux.setResponses([
			fauxAssistantMessage("I am done"),
			fauxAssistantMessage("Still no action"),
			fauxAssistantMessage("No plan"),
		]);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "Complete the game.",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "Recovered observation",
			boundary: fixture.boundary,
			pendingCheckpoint: async () => false,
		});
		try {
			const result = await runtime.prompt("Initial observation");
			expect(result.kind).toBe("terminal");
			expect(fixture.authority.termination?.terminationReason).toBe("model_no_progress");
			expect(fixture.faux.state.callCount).toBe(3);
			expect(fixture.records.filter((record) => record.eventType === "context.boundary")).toHaveLength(1);
			expect(fixture.playCount).toBe(0);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it("provides a recovery envelope when the committed Turn leads Pi settlement", async () => {
		const fixture = harnessFixture();
		fixture.authority.turn.turn = 1;
		fixture.authority.turn.actionId = "prior-play";
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		let transcript = "";
		fixture.faux.setResponses([
			(context) => {
				transcript = JSON.stringify(context);
				return fauxAssistantMessage(fauxToolCall("play", { action: "ACTION1" }), { stopReason: "toolUse" });
			},
			fauxAssistantMessage("done"),
		]);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "Complete the game.",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "Recovered observation",
			boundary: fixture.boundary,
			pendingCheckpoint: async () => false,
		});
		try {
			await runtime.prompt("ignored initial prompt");
			expect(transcript).toContain("Recovered observation");
			expect(transcript).not.toContain("ignored initial prompt");
			expect(fixture.playCount).toBe(1);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it("inventories an open Pi operation and drives it only after ARC recovery", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		const preflightTools = await PiToolAdapter.create({
			executor: new ModelToolExecutor(fixture.ports),
			evidence: fixture.evidence,
			now,
			isTerminated: () => false,
		});
		const preflight = await AgentHarness.create(
			{
				session,
				models: fixture.models,
				model: fixture.faux.getModel(),
				tools: preflightTools.tools(),
				toolExecution: "sequential",
			},
			TODO_CONTEXT,
		);
		const lane = await preflight.harness.lane("main", TODO_CONTEXT);
		const admitted = await lane.accept({ kind: "prompt", prompt: "open operation" }, TODO_CONTEXT);
		expect(admitted.ok).toBe(true);
		await preflight.harness.close(TODO_CONTEXT);
		const reopened = await fixture.repo.open(session.metadata, TODO_CONTEXT);
		fixture.faux.setResponses([
			fauxAssistantMessage(fauxToolCall("play", { action: "ACTION1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		let recovered = false;
		const runtime = await PiArcRuntime.attach({
			session: reopened,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "Complete the game.",
			evidence: fixture.evidence,
			now,
			recoverAuthority: () => {
				recovered = true;
				return Promise.resolve(fixture.authority);
			},
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "Recovered observation",
			boundary: fixture.boundary,
			pendingCheckpoint: async () => false,
		});
		try {
			expect(runtime.open).toHaveLength(1);
			expect(recovered).toBe(true);
			expect(fixture.faux.state.callCount).toBe(0);
			const steps = await runtime.driveOpen();
			expect(steps.map((step) => step.kind)).toEqual(["settled"]);
			expect(fixture.playCount).toBe(1);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it("applies the no-progress limit to a recovered open model operation", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		const original = await AgentHarness.create(
			{
				session,
				models: fixture.models,
				model: fixture.faux.getModel(),
				toolExecution: "sequential",
			},
			TODO_CONTEXT,
		);
		const lane = await original.harness.lane("main", TODO_CONTEXT);
		expect((await lane.accept({ kind: "prompt", prompt: "open operation" }, TODO_CONTEXT)).ok).toBe(true);
		await original.harness.close(TODO_CONTEXT);
		const reopened = await fixture.repo.open(session.metadata, TODO_CONTEXT);
		fixture.faux.setResponses([
			fauxAssistantMessage("Stopped"),
			fauxAssistantMessage("Still stopped"),
			fauxAssistantMessage("Nothing to do"),
		]);
		const runtime = await PiArcRuntime.attach({
			session: reopened,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "Complete the game.",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "Recovered observation",
			boundary: fixture.boundary,
			pendingCheckpoint: async () => false,
		});
		try {
			const steps = await runtime.driveOpen();
			expect(steps.map((step) => step.kind)).toEqual(["terminal"]);
			expect(fixture.authority.termination?.terminationReason).toBe("model_no_progress");
			expect(fixture.faux.state.callCount).toBe(3);
			expect(fixture.playCount).toBe(0);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it("never executes a partial provider tool call and classifies failed settlement", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		fixture.faux.setResponses(
			Array.from({ length: 4 }, () =>
				fauxAssistantMessage(fauxToolCall("play", { action: "ACTION1" }), {
					stopReason: "error",
					errorMessage: "synthetic provider failure",
				}),
			),
		);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "Complete the game.",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "Recovered observation",
			boundary: fixture.boundary,
			pendingCheckpoint: async () => false,
		});
		try {
			const result = await runtime.prompt("Initial observation");
			expect(result.kind).toBe("terminal");
			expect(fixture.authority.termination?.terminationReason).toBe("model_failure");
			expect(fixture.playCount).toBe(0);
			expect(fixture.records.some((record) => record.eventType === "tool.admitted")).toBe(false);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	}, 20_000);

	it("admits a committed boundary prompt before acknowledging it and allowing play", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		let acknowledged = false;
		fixture.ports.knowledge.boundaryPending = async () => !acknowledged;
		fixture.faux.setResponses([
			fauxAssistantMessage(fauxToolCall("play", { action: "ACTION1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "Complete the game.",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "Fallback recovery",
			boundary: {
				prepare: async () => ({ boundaryId: "reset-7", prompt: "Committed RESET recovery" }),
				acknowledge: () => {
					acknowledged = true;
					return Promise.resolve();
				},
			},
			pendingCheckpoint: async () => false,
		});
		try {
			const result = await runtime.prompt("ignored prompt");
			expect(result.kind).toBe("settled");
			expect(acknowledged).toBe(true);
			expect(fixture.playCount).toBe(1);
			expect(fixture.records.filter((record) => record.eventType === "tool.rejected")).toHaveLength(0);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it("does not drive or prompt a terminal Run", async () => {
		const fixture = harnessFixture();
		await fixture.authority.finish("cancelled");
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "Complete the game.",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "unused",
			boundary: fixture.boundary,
			pendingCheckpoint: async () => false,
		});
		try {
			expect((await runtime.driveOpen()).map((step) => step.kind)).toEqual(["terminal"]);
			expect((await runtime.prompt("must not be sent")).kind).toBe("terminal");
			expect(fixture.faux.state.callCount).toBe(0);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it("classifies unavailable model configuration without issuing a provider request", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		await expect(
			PiArcRuntime.attach({
				session,
				models: fixture.models,
				provider: "not-configured",
				modelId: "missing-model",
				laneId: "main",
				systemPrompt: "Complete the game.",
				evidence: fixture.evidence,
				now,
				recoverAuthority: async () => fixture.authority,
				validateKnowledge: async () => {},
				createExecutor: () => new ModelToolExecutor(fixture.ports),
				buildRecoveryEnvelope: async () => "unused",
				boundary: fixture.boundary,
				pendingCheckpoint: async () => false,
			}),
		).rejects.toThrow("unavailable");
		expect(fixture.authority.termination?.terminationReason).toBe("model_failure");
		expect(fixture.faux.state.callCount).toBe(0);
		await fixture.repo.close(TODO_CONTEXT);
	});

	it("treats a configured model with unavailable credentials as unusable", async () => {
		const fixture = harnessFixture();
		const model = fixture.faux.getModel();
		const withoutCredentials = {
			getModel: () => model,
			getAuth: () => Promise.resolve(undefined),
		};
		expect(
			await resolveRuntimeModel(
				withoutCredentials as unknown as typeof fixture.models,
				fixture.faux.provider.id,
				model.id,
			),
		).toBeNull();
	});

	it("pins safe-tool parameters to the stable Pi invocation memo", async () => {
		const fixture = harnessFixture();
		const adapter = await PiToolAdapter.create({
			executor: new ModelToolExecutor(fixture.ports),
			evidence: fixture.evidence,
			now,
			isTerminated: () => false,
		});
		const history = adapter.tools().find((tool) => tool.name === "history");
		expect(history).toBeDefined();
		const memo = new Map<string, string>();
		const invocation = {
			invocationId: "safe-1",
			operationId: "operation-1",
			turnId: "response-1",
			getMemo: async (key: string) => memo.get(key),
			setMemo: (key: string, value: unknown) => {
				if (typeof value === "string") memo.set(key, value);
				return Promise.resolve();
			},
		};
		await history?.execute("call-1", { view: "events" }, () => {}, undefined, invocation, TODO_CONTEXT);
		await expect(
			history?.execute("call-1", { view: "attempts" }, () => {}, undefined, invocation, TODO_CONTEXT),
		).rejects.toThrow("arguments changed");
		expect(fixture.records.filter((record) => record.eventType === "tool.completed")).toHaveLength(1);
	});

	it("recovers a boundary accepted before crash and acknowledges it before driving", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		let acknowledged = false;
		fixture.ports.knowledge.boundaryPending = async () => !acknowledged;
		const originalTools = await PiToolAdapter.create({
			executor: new ModelToolExecutor(fixture.ports),
			evidence: fixture.evidence,
			now,
			isTerminated: () => false,
		});
		const original = await AgentHarness.create(
			{
				session,
				models: fixture.models,
				model: fixture.faux.getModel(),
				tools: originalTools.tools(),
				toolExecution: "sequential",
			},
			TODO_CONTEXT,
		);
		const lane = await original.harness.lane("main", TODO_CONTEXT);
		const accepted = await lane.accept(
			{
				kind: "prompt",
				operationId: "pi-arc-boundary-reset-7",
				prompt: "Committed RESET recovery",
			},
			TODO_CONTEXT,
		);
		expect(accepted.ok).toBe(true);
		await original.harness.close(TODO_CONTEXT);
		const reopened = await fixture.repo.open(session.metadata, TODO_CONTEXT);
		fixture.faux.setResponses([
			fauxAssistantMessage(fauxToolCall("play", { action: "ACTION1" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		const runtime = await PiArcRuntime.attach({
			session: reopened,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "Complete the game.",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "Fallback recovery",
			boundary: {
				prepare: async () => ({ boundaryId: "reset-7", prompt: "Committed RESET recovery" }),
				acknowledge: () => {
					acknowledged = true;
					return Promise.resolve();
				},
			},
			pendingCheckpoint: async () => false,
		});
		try {
			expect(runtime.open).toHaveLength(1);
			expect((await runtime.driveOpen()).map((step) => step.kind)).toEqual(["settled"]);
			expect(acknowledged).toBe(true);
			expect(fixture.playCount).toBe(1);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it("rejects late tools and redacts a failing safe-tool storage message", async () => {
		const fixture = harnessFixture();
		let terminated = true;
		const adapter = await PiToolAdapter.create({
			executor: new ModelToolExecutor(fixture.ports),
			evidence: fixture.evidence,
			now,
			isTerminated: () => terminated,
		});
		const history = adapter.tools().find((tool) => tool.name === "history");
		const memo = new Map<string, string>();
		const invocation = {
			invocationId: "late-tool",
			operationId: "operation-late",
			turnId: "response-late",
			getMemo: async (key: string) => memo.get(key),
			setMemo: (key: string, value: unknown) => {
				if (typeof value === "string") memo.set(key, value);
				return Promise.resolve();
			},
		};
		const late = await history?.execute("late", { view: "events" }, () => {}, undefined, invocation, TODO_CONTEXT);
		expect(late?.terminate).toBe(true);
		expect(late?.details).toMatchObject({ ok: false, error: { code: "terminal" } });
		terminated = false;
		fixture.ports.evidence.readDomain = () => Promise.reject(new Error("sensitive storage path"));
		await expect(
			history?.execute("fault", { view: "events" }, () => {}, undefined, invocation, TODO_CONTEXT),
		).rejects.toThrow("Tool storage failed");
		expect(fixture.records.at(-1)?.payload.code).toBe("storage_failure");
		expect(JSON.stringify(fixture.records)).not.toContain("sensitive storage path");
	});

	it("resumes an unfinished checkpoint with its checkpoint-only prompt", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		let firstRequest = "";
		fixture.faux.setResponses([
			(context) => {
				firstRequest = JSON.stringify(context);
				return fauxAssistantMessage("No checkpoint yet");
			},
			fauxAssistantMessage("Still no checkpoint"),
			fauxAssistantMessage("No progress"),
		]);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "Complete the game.",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "Call save_compact_checkpoint now",
			boundary: fixture.boundary,
			pendingCheckpoint: async () => true,
		});
		try {
			await runtime.prompt("must be replaced");
			expect(firstRequest).toContain("Call save_compact_checkpoint now");
			expect(firstRequest).not.toContain("must be replaced");
			expect(fixture.playCount).toBe(0);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});
});
