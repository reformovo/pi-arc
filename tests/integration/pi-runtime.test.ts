/** 使用公开 faux Models 验证 Pi 顺序工具循环和 ARC 恢复门禁，不接真实模型。 */

import { AgentHarness, MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import {
	branchTip,
	insertEntry,
	laneConfig,
	laneState,
	operationMeta,
	operationState,
	operationToolArgsPrefix,
	operationToolMemoPrefix,
	setValue,
	type Write,
} from "@earendil-works/pi-agent-core/harness/session";
import { createAssistantMessageEventStream, createModels, type Context as ModelContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";
import type { RuntimeRecord } from "../../src/adapters/artifact-store.js";
import { canonicalJsonDigest } from "../../src/adapters/sha256.js";
import { ModelToolExecutor, type ToolRuntimePorts } from "../../src/application/model-tools.js";
import { countContextImages } from "../../src/composition/image-capacity.js";
import type { RuntimeAuthority } from "../../src/composition/pi-runtime.js";
import {
	contextThresholds,
	OrdinaryProgressGuard,
	PiArcRuntime,
	resolveRuntimeModel,
} from "../../src/composition/pi-runtime.js";
import { PiToolAdapter, type PiToolEvidence } from "../../src/composition/pi-tools.js";

const now = () => "2026-09-24T00:00:00Z";

function harnessFixture(contextWindow?: number, imageCapacity = false) {
	const faux = fauxProvider(
		imageCapacity
			? { provider: "opencode-go", models: [{ id: "deepseek-capacity", contextWindow: contextWindow ?? 1_000_000 }] }
			: contextWindow === undefined
				? {}
				: { models: [{ id: "context-policy", contextWindow }] },
	);
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
	it.each([
		{ initial: 48, views: 16, admitted: true },
		{ initial: 49, views: 16, admitted: false },
		{ initial: 62, views: 1, admitted: true },
		{ initial: 63, views: 1, admitted: true },
		{ initial: 64, views: 1, admitted: false },
	])(
		"admits exact inspect capacity $initial + $views without rewriting old images",
		async ({ initial, views, admitted }) => {
			const fixture = harnessFixture(1_000_000, true);
			const session = await fixture.repo.create({}, TODO_CONTEXT);
			const adapter = await PiToolAdapter.create({
				executor: new ModelToolExecutor(fixture.ports),
				evidence: fixture.evidence,
				now,
				isTerminated: () => false,
			});
			const seeded = await AgentHarness.create(
				{
					session,
					models: fixture.models,
					model: fixture.faux.getModel(),
					tools: adapter.tools(),
					toolExecution: "sequential",
				},
				TODO_CONTEXT,
			);
			const lane = await seeded.harness.lane("main", TODO_CONTEXT);
			const original = {
				role: "user" as const,
				content: Array.from({ length: initial }, (_, index) => ({
					type: "image" as const,
					mimeType: "image/png",
					data: `OLD_${index}`,
				})),
				timestamp: 0,
			};
			await lane.appendMessage(original, TODO_CONTEXT);
			await seeded.harness.close(TODO_CONTEXT);
			const reopened = await fixture.repo.open(session.metadata, TODO_CONTEXT);
			let inspected = 0;
			fixture.ports.evidence.readFrame = () => {
				inspected += 1;
				return Promise.resolve({
					turn: 0,
					frame: 0,
					visualRef: "archived",
					visual: { width: 1, height: 1, rgb: Uint8Array.from([0, 0, 0]) },
				});
			};
			let requested = false;
			let committed = false;
			let acknowledged = false;
			fixture.ports.knowledge.checkpointRequested = async () => requested && !committed;
			fixture.ports.knowledge.boundaryPending = async () => committed && !acknowledged;
			fixture.ports.knowledge.saveCheckpoint = () => {
				committed = true;
				return Promise.resolve({
					checkpointId: "images",
					anchor: "0",
					guideVersion: 1,
					workingVersion: 1,
					commitDigest: "commit",
				});
			};
			const counts: number[] = [];
			const segmentRequests: ModelContext["messages"][] = [];
			let checkpointRequest = "";
			let freshRequest = "";
			const inspect = fauxAssistantMessage(
				fauxToolCall("inspect", {
					question: "look",
					views: Array.from({ length: views }, (_, index) => ({ label: `v${index}`, turn: 0 })),
				}),
				{ stopReason: "toolUse" },
			);
			const checkpoint = (context: ModelContext) => {
				checkpointRequest = JSON.stringify(context);
				return fauxAssistantMessage(
					fauxToolCall("save_compact_checkpoint", { guide: null, working_memory: "capacity notes" }),
					{ stopReason: "toolUse" },
				);
			};
			fixture.faux.setResponses([
				inspect,
				...(initial + views >= 64
					? [
							checkpoint,
							(context: ModelContext) => {
								freshRequest = JSON.stringify(context);
								return fauxAssistantMessage(fauxToolCall("play", { action: "ACTION1" }), {
									stopReason: "toolUse",
								});
							},
						]
					: [fauxAssistantMessage(fauxToolCall("play", { action: "ACTION1" }), { stopReason: "toolUse" })]),
				fauxAssistantMessage("done"),
			]);
			fixture.models.setProvider({
				...fixture.faux.provider,
				streamSimple: (model, context, options) => {
					counts.push(countContextImages(context.messages));
					// Public provider conversion must leave the old message byte-identical in this segment.
					if (!acknowledged) segmentRequests.push(structuredClone(context.messages));
					return fixture.faux.provider.streamSimple(model, context, options);
				},
			});
			const runtime = await PiArcRuntime.attach({
				session: reopened,
				models: fixture.models,
				provider: fixture.faux.provider.id,
				modelId: fixture.faux.getModel().id,
				laneId: "main",
				systemPrompt: "test",
				evidence: fixture.evidence,
				now,
				recoverAuthority: async () => fixture.authority,
				validateKnowledge: async () => {},
				createExecutor: () => new ModelToolExecutor(fixture.ports),
				buildRecoveryEnvelope: async () => "authority",
				pendingCheckpoint: async () => requested && !committed,
				requestCheckpoint: () => {
					requested = true;
					return Promise.resolve();
				},
				recoveryImages: async () =>
					committed || initial === 64 ? [{ type: "image", data: "CURRENT", mimeType: "image/png" }] : [],
				boundary: {
					prepare: async () =>
						committed && !acknowledged
							? { boundaryId: "images", prompt: "authority GUIDE WORKING capacity notes" }
							: null,
					acknowledge: () => {
						acknowledged = true;
						return Promise.resolve();
					},
				},
			});
			try {
				await runtime.prompt("inspect next");
				expect(segmentRequests[0]?.[1]?.content).toEqual(expect.arrayContaining(original.content));
				for (const request of segmentRequests.slice(1)) {
					const previous = segmentRequests[0];
					expect(request.slice(0, previous?.length)).toEqual(previous);
				}
				expect(inspected).toBe(admitted ? views : 0);
				expect(Math.max(...counts)).toBeLessThanOrEqual(64);
				expect(fixture.playCount).toBe(1);
				if (initial + views >= 64) {
					expect(checkpointRequest).toContain("OLD_0");
					expect(freshRequest).not.toContain("OLD_0");
					expect(freshRequest).toContain("capacity notes");
					expect(freshRequest).toContain("CURRENT");
					expect(counts[2]).toBe(1);
					expect(counts[1]).toBe(admitted ? initial + views : initial);
				}
			} finally {
				await runtime.close();
				await fixture.repo.close(TODO_CONTEXT);
			}
		},
	);

	it.each([0, 63, 64])(
		"settles a recovered safe effect_pending receipt at %i images without resending overflow",
		async (initial) => {
			const fixture = harnessFixture(undefined, true);
			const session = await fixture.repo.create({}, TODO_CONTEXT);
			const adapter = await PiToolAdapter.create({
				executor: new ModelToolExecutor(fixture.ports),
				evidence: fixture.evidence,
				now,
				isTerminated: () => false,
			});
			const seeded = await AgentHarness.create(
				{
					session,
					models: fixture.models,
					model: fixture.faux.getModel(),
					tools: adapter.tools().map((tool) => ({
						...tool,
						execute: async (...args: Parameters<typeof tool.execute>) => ({
							...(await tool.execute(...args)),
							terminate: true,
						}),
					})),
					toolExecution: "sequential",
				},
				TODO_CONTEXT,
			);
			const lane = await seeded.harness.lane("main", TODO_CONTEXT);
			await lane.appendMessage(
				{
					role: "user",
					content: Array.from({ length: initial }, () => ({ type: "image", data: "OLD", mimeType: "image/png" })),
					timestamp: 0,
				},
				TODO_CONTEXT,
			);
			const admission = await lane.accept({ kind: "prompt", prompt: "inspect" }, TODO_CONTEXT);
			if (!admission.ok) throw new Error("admission failed");
			const operationId = admission.value.operationId;
			let snapshot: Write[] = [];
			let reads = 0;
			fixture.ports.evidence.readFrame = async () => {
				reads += 1;
				if (reads === 1) {
					const state = await session.getValue(operationState(operationId), TODO_CONTEXT);
					const active = await session.getValue(laneState("main"), TODO_CONTEXT);
					const tip = await session.getValue(branchTip("main"), TODO_CONTEXT);
					if (!state || !active || !tip) throw new Error("missing durable pending state");
					const meta = await session.getValue(operationMeta(operationId), TODO_CONTEXT);
					if (!meta) throw new Error("missing operation metadata");
					const args = await session.scanValues(operationToolArgsPrefix(operationId), TODO_CONTEXT);
					const memos = await session.scanValues(operationToolMemoPrefix(operationId), TODO_CONTEXT);
					const config = await session.getValue(laneConfig("main"), TODO_CONTEXT);
					if (!config) throw new Error("missing configuration");
					const entries = await session.findEntries({ order: "asc" }, TODO_CONTEXT);
					snapshot = [
						...entries.map((entry) => insertEntry(entry)),
						setValue(config.address, config.value),
						setValue(state.address, state.value),
						setValue(meta.address, meta.value),
						setValue(active.address, active.value),
						setValue(tip.address, tip.value),
						...args.map((item) => setValue(item.address, item.value)),
						...memos.map((item) => setValue(item.address, item.value)),
					];
				}
				return {
					turn: 0,
					frame: 0,
					visualRef: "archived",
					visual: { width: 1, height: 1, rgb: Uint8Array.from([0, 0, 0]) },
				};
			};
			fixture.faux.setResponses([
				fauxAssistantMessage(fauxToolCall("inspect", { question: "look", views: [{ label: "v", turn: 0 }] }), {
					stopReason: "toolUse",
				}),
			]);
			await lane.drive({ operationId }, TODO_CONTEXT);
			await seeded.harness.close(TODO_CONTEXT);
			const reopened = await fixture.repo.create({}, TODO_CONTEXT);
			// 用公开 entry/value writes 复制 effect_pending 持久快照，模拟进程中断。
			await reopened.mutate((mutation) => mutation.commit(snapshot, TODO_CONTEXT), TODO_CONTEXT);
			let requested = false;
			if (initial === 0) {
				const guard = new OrdinaryProgressGuard({ evidence: fixture.evidence, now }, fixture.authority);
				await guard.restore();
				await guard.begin(2);
				await guard.response(Array.from({ length: 16 }, (_, i) => `pending-${i}`));
			}
			const runtime = await PiArcRuntime.attach({
				session: reopened,
				models: fixture.models,
				provider: fixture.faux.provider.id,
				modelId: fixture.faux.getModel().id,
				laneId: "main",
				systemPrompt: "test",
				evidence: fixture.evidence,
				now,
				recoverAuthority: async () => fixture.authority,
				validateKnowledge: async () => {},
				createExecutor: () => new ModelToolExecutor(fixture.ports),
				buildRecoveryEnvelope: async () => "authority",
				pendingCheckpoint: async () => requested,
				requestCheckpoint: () => {
					requested = true;
					return Promise.reject(new Error("anchor unavailable"));
				},
				boundary: fixture.boundary,
			});
			try {
				await runtime.driveOpen();
				expect(reads).toBe(2);
				expect(fixture.faux.state.callCount).toBe(1);
				expect(fixture.authority.termination?.terminationReason).toBe(
					initial === 0 ? "model_no_progress" : "checkpoint_failed",
				);
				expect(requested).toBe(initial === 63);
				const results = await reopened.findEntries({ type: "message" }, TODO_CONTEXT);
				expect(
					results.filter(
						(entry) =>
							entry.type === "message" &&
							entry.message.role === "toolResult" &&
							entry.message.toolName === "inspect",
					),
				).toHaveLength(1);
			} finally {
				await runtime.close();
				await fixture.repo.close(TODO_CONTEXT);
			}
		},
	);

	it.each([true, false])("applies restored image generation capacity only for DeepSeek=%s", async (deepseek) => {
		const fixture = harnessFixture(undefined, deepseek);
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		const seeded = await AgentHarness.create(
			{ session, models: fixture.models, model: fixture.faux.getModel() },
			TODO_CONTEXT,
		);
		const lane = await seeded.harness.lane("main", TODO_CONTEXT);
		await lane.appendMessage(
			{
				role: "user",
				content: Array.from({ length: 65 }, () => ({ type: "image", data: "IMMUTABLE", mimeType: "image/png" })),
				timestamp: 0,
			},
			TODO_CONTEXT,
		);
		fixture.faux.setResponses([
			fauxAssistantMessage("done"),
			fauxAssistantMessage("done"),
			fauxAssistantMessage("done"),
		]);
		await lane.accept({ kind: "prompt", prompt: "already admitted" }, TODO_CONTEXT);
		await seeded.harness.close(TODO_CONTEXT);
		const runtime = await PiArcRuntime.attach({
			session: await fixture.repo.open(session.metadata, TODO_CONTEXT),
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "test",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "authority",
			pendingCheckpoint: async () => false,
			boundary: fixture.boundary,
		});
		try {
			await runtime.driveOpen();
			expect(fixture.faux.state.callCount).toBe(deepseek ? 0 : 3);
			expect(fixture.authority.termination?.terminationReason).toBe(
				deepseek ? "checkpoint_failed" : "model_no_progress",
			);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it("uses VISTA reserves, not the rejected 200k limit", () => {
		expect(contextThresholds(1_000_000)).toEqual({ normal: 928_000, checkpoint: 968_000 });
		expect(contextThresholds(272_000)).toEqual({ normal: 200_000, checkpoint: 240_000 });
		expect(() => contextThresholds(80_000)).toThrow("too small");
	});

	it.each([927_999, 928_000, 967_999, 968_000])(
		"gates full cached input %i and saves in the old context before a genuinely fresh request",
		async (input) => {
			const fixture = harnessFixture(1_000_000);
			const session = await fixture.repo.create({}, TODO_CONTEXT);
			const originalAdapter = await PiToolAdapter.create({
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
					tools: originalAdapter.tools(),
					toolExecution: "sequential",
				},
				TODO_CONTEXT,
			);
			const oldLane = await original.harness.lane("main", TODO_CONTEXT);
			await oldLane.appendMessage(
				{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "OLD_VISUAL" }], timestamp: 0 },
				TODO_CONTEXT,
			);
			await original.harness.close(TODO_CONTEXT);
			const reopened = await fixture.repo.open(session.metadata, TODO_CONTEXT);
			// Faux recomputes usage; this scripted public Provider supplies server usage
			// without touching runtime/provider payloads.
			fixture.models.setProvider({
				...fixture.faux.provider,
				streamSimple: (model, context, options) => {
					const source = fixture.faux.provider.streamSimple(model, context, options);
					const output = createAssistantMessageEventStream();
					void (async () => {
						for await (const event of source) {
							if (event.type === "done" && fixture.faux.state.callCount <= 2) {
								event.message.usage.input = 1;
								event.message.usage.cacheRead = input - 101;
								event.message.usage.cacheWrite = 100;
							}
							output.push(event);
						}
					})();
					return output;
				},
			});
			let requested = false;
			let committed = false;
			let acknowledged = false;
			let oldRequest = "";
			let freshRequest = "";
			fixture.ports.knowledge.checkpointRequested = async () => requested && !committed;
			fixture.ports.knowledge.boundaryPending = async () => committed && !acknowledged;
			fixture.ports.knowledge.saveCheckpoint = () => {
				committed = true;
				return Promise.resolve({
					checkpointId: "capacity",
					anchor: "0",
					guideVersion: 1,
					workingVersion: 1,
					commitDigest: "commit",
				});
			};
			const high = fauxAssistantMessage(
				[{ type: "thinking", thinking: "OLD_PRIVATE_REASONING" }, fauxToolCall("play", { action: "ACTION1" })],
				{ stopReason: "toolUse" },
			);
			high.usage = { ...high.usage, input: 1, cacheRead: 0, cacheWrite: 0 };
			high.usage.cacheRead = input - 101;
			high.usage.cacheWrite = 100;
			fixture.faux.setResponses(
				input < 928_000
					? [high, fauxAssistantMessage("done")]
					: [
							high,
							(context) => {
								oldRequest = JSON.stringify(context);
								const saved = fauxAssistantMessage(
									fauxToolCall("save_compact_checkpoint", { guide: null, working_memory: "notes" }),
									{ stopReason: "toolUse" },
								);
								saved.usage = { ...saved.usage, input, cacheRead: 0, cacheWrite: 0 };
								return saved;
							},
							(context) => {
								freshRequest = JSON.stringify(context);
								return fauxAssistantMessage(fauxToolCall("play", { action: "ACTION1" }), {
									stopReason: "toolUse",
								});
							},
							fauxAssistantMessage("done"),
						],
			);
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
				buildRecoveryEnvelope: async () => "authoritative current observation",
				pendingCheckpoint: async () => requested && !committed,
				requestCheckpoint: () => {
					requested = true;
					return Promise.resolve();
				},
				recoveryImages: async () => [{ type: "image", mimeType: "image/png", data: "CURRENT_VISUAL" }],
				boundary: {
					prepare: async () =>
						committed && !acknowledged
							? { boundaryId: "capacity", prompt: "authority lastAction GUIDE WORKING notes" }
							: null,
					acknowledge: () => {
						acknowledged = true;
						return Promise.resolve();
					},
				},
			});
			try {
				const result = await runtime.prompt("OLD_CONTEXT_PROMPT");
				if (input >= 968_000) {
					expect(result.kind).toBe("terminal");
					expect(fixture.authority.termination?.terminationReason).toBe("checkpoint_failed");
					expect(fixture.faux.state.callCount).toBe(1);
					expect(fixture.playCount).toBe(0);
				} else {
					expect(fixture.playCount).toBe(1);
					if (input >= 928_000) {
						expect(oldRequest).toContain("OLD_PRIVATE_REASONING");
						expect(oldRequest).toContain("OLD_CONTEXT_PROMPT");
						expect(freshRequest).not.toContain("OLD_PRIVATE_REASONING");
						expect(freshRequest).not.toContain("OLD_CONTEXT_PROMPT");
						expect(oldRequest).toContain("OLD_VISUAL");
						expect(freshRequest).not.toContain("OLD_VISUAL");
						expect(freshRequest).toContain("authority lastAction GUIDE WORKING notes");
						expect(freshRequest).toContain("CURRENT_VISUAL");
						expect(
							fixture.records.filter((record) => record.payload.phase === "provider_request").length,
						).toBeGreaterThan(0);
						expect(acknowledged).toBe(true);
					} else expect(requested).toBe(false);
				}
			} finally {
				await runtime.close();
				await fixture.repo.close(TODO_CONTEXT);
			}
		},
	);
	it.each(["refusal", "save_failure", "ordinary_tool"])(
		"bounds checkpoint %s attempts durably without play or fresh navigation",
		async (failure) => {
			const fixture = harnessFixture();
			const session = await fixture.repo.create({}, TODO_CONTEXT);
			fixture.ports.knowledge.checkpointRequested = async () => true;
			const response =
				failure === "refusal"
					? fauxAssistantMessage("cannot save")
					: fauxAssistantMessage(
							fauxToolCall(
								failure === "save_failure" ? "save_compact_checkpoint" : "play",
								failure === "save_failure" ? { guide: null, working_memory: "notes" } : { action: "ACTION1" },
							),
							{ stopReason: "toolUse" },
						);
			fixture.faux.setResponses([response, response]);
			const options = {
				session,
				models: fixture.models,
				provider: fixture.faux.provider.id,
				modelId: fixture.faux.getModel().id,
				laneId: "main",
				systemPrompt: "test",
				evidence: fixture.evidence,
				now,
				recoverAuthority: async () => fixture.authority,
				validateKnowledge: async () => {},
				createExecutor: () => new ModelToolExecutor(fixture.ports),
				buildRecoveryEnvelope: async () => "Call save_compact_checkpoint now",
				pendingCheckpoint: async () => true,
				boundary: fixture.boundary,
			};
			const runtime = await PiArcRuntime.attach(options);
			try {
				const result = await runtime.prompt("unused");
				expect(result.kind).toBe("terminal");
				expect(fixture.authority.termination?.terminationReason).toBe("checkpoint_failed");
				expect(fixture.playCount).toBe(0);
				expect(fixture.faux.state.callCount).toBeLessThanOrEqual(2);
				expect(fixture.records.filter((record) => record.payload.phase === "checkpoint.fresh")).toHaveLength(0);
				expect(
					fixture.records.filter((record) => record.payload.phase === "checkpoint.attempt").length,
				).toBeGreaterThan(0);
			} finally {
				await runtime.close();
				await fixture.repo.close(TODO_CONTEXT);
			}
		},
	);

	it("recovers fresh boundary admission interrupted before acknowledgement without restoring old context", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		const tools = await PiToolAdapter.create({
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
				tools: tools.tools(),
				toolExecution: "sequential",
			},
			TODO_CONTEXT,
		);
		const lane = await original.harness.lane("main", TODO_CONTEXT);
		await lane.appendMessage({ role: "user", content: "OLD_TRANSCRIPT", timestamp: 0 }, TODO_CONTEXT);
		await original.harness.close(TODO_CONTEXT);
		let acknowledged = false;
		fixture.ports.knowledge.boundaryPending = async () => !acknowledged;
		let interrupted = true;
		let received = "";
		fixture.faux.setResponses([
			(context) => {
				received = JSON.stringify(context);
				return fauxAssistantMessage(fauxToolCall("play", { action: "ACTION1" }), { stopReason: "toolUse" });
			},
			fauxAssistantMessage("done"),
		]);
		const options = {
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "test",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "authority",
			pendingCheckpoint: async () => false,
			recoveryImages: async () => [{ type: "image" as const, mimeType: "image/png", data: "CURRENT_VISUAL" }],
			boundary: {
				prepare: async () =>
					acknowledged ? null : { boundaryId: "checkpoint-7", prompt: "GUIDE WORKING lastAction observation" },
				acknowledge: () => {
					if (interrupted) return Promise.reject(new Error("crash"));
					acknowledged = true;
					return Promise.resolve();
				},
			},
		};
		const first = await PiArcRuntime.attach({
			...options,
			session: await fixture.repo.open(session.metadata, TODO_CONTEXT),
		});
		await expect(first.prompt("ignored")).rejects.toThrow("crash");
		expect(fixture.faux.state.callCount).toBe(0);
		await first.close();
		interrupted = false;
		const recovered = await PiArcRuntime.attach({
			...options,
			session: await fixture.repo.open(session.metadata, TODO_CONTEXT),
		});
		try {
			await recovered.driveOpen();
			expect(acknowledged).toBe(true);
			expect(fixture.playCount).toBe(1);
			expect(received).toContain("GUIDE WORKING lastAction observation");
			expect(received).toContain("CURRENT_VISUAL");
			expect(received).not.toContain("OLD_TRANSCRIPT");
		} finally {
			await recovered.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it.each([true, false])("classifies checkpoint anchor failure before tool=%s without any action", async (tool) => {
		const fixture = harnessFixture(1_000_000);
		fixture.models.setProvider({
			...fixture.faux.provider,
			streamSimple: (model, context, options) => {
				const output = createAssistantMessageEventStream();
				const source = fixture.faux.provider.streamSimple(model, context, options);
				void (async () => {
					for await (const event of source) {
						if (event.type === "done") event.message.usage.input = 928_000;
						output.push(event);
					}
				})();
				return output;
			},
		});
		fixture.faux.setResponses([
			tool
				? fauxAssistantMessage(fauxToolCall("play", { action: "ACTION1" }), { stopReason: "toolUse" })
				: fauxAssistantMessage("stopped"),
		]);
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "test",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "checkpoint",
			pendingCheckpoint: async () => false,
			boundary: fixture.boundary,
			requestCheckpoint: () => Promise.reject(new Error("anchor moved")),
		});
		try {
			await runtime.prompt("start");
			expect(fixture.authority.termination?.terminationReason).toBe("checkpoint_failed");
			expect(fixture.faux.state.callCount).toBe(1);
			expect(fixture.playCount).toBe(0);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it("bounds repeated fresh-checkpoint cycles at the same authoritative turn", async () => {
		const fixture = harnessFixture(1_000_000);
		fixture.models.setProvider({
			...fixture.faux.provider,
			streamSimple: (model, context, options) => {
				const output = createAssistantMessageEventStream();
				const source = fixture.faux.provider.streamSimple(model, context, options);
				void (async () => {
					for await (const event of source) {
						if (event.type === "done") event.message.usage.input = 928_000;
						output.push(event);
					}
				})();
				return output;
			},
		});
		let pending = false;
		let boundary = false;
		let cycle = 0;
		fixture.ports.knowledge.checkpointRequested = async () => pending;
		fixture.ports.knowledge.boundaryPending = async () => boundary;
		fixture.ports.knowledge.saveCheckpoint = () => {
			pending = false;
			boundary = true;
			cycle += 1;
			return Promise.resolve({
				checkpointId: `${cycle}`,
				anchor: "0",
				guideVersion: 1,
				workingVersion: cycle,
				commitDigest: "commit",
			});
		};
		const saved = fauxAssistantMessage(
			fauxToolCall("save_compact_checkpoint", { guide: null, working_memory: "notes" }),
			{ stopReason: "toolUse" },
		);
		fixture.faux.setResponses([
			fauxAssistantMessage("stop"),
			saved,
			fauxAssistantMessage("stop"),
			saved,
			fauxAssistantMessage("stop"),
		]);
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "test",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "checkpoint",
			pendingCheckpoint: async () => pending,
			requestCheckpoint: () => {
				pending = true;
				return Promise.resolve();
			},
			boundary: {
				prepare: async () => (boundary ? { boundaryId: `${cycle}`, prompt: "authority notes" } : null),
				acknowledge: () => {
					boundary = false;
					return Promise.resolve();
				},
			},
		});
		try {
			await runtime.prompt("start");
			expect(fixture.authority.termination?.terminationReason).toBe("checkpoint_failed");
			expect(cycle).toBe(2);
			expect(fixture.faux.state.callCount).toBe(5);
			expect(fixture.playCount).toBe(0);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it.each([928_000, 928_001, 968_000])(
		"restores input allowance %i from the durable branch before another request",
		async (input) => {
			const fixture = harnessFixture(1_000_000);
			const session = await fixture.repo.create({}, TODO_CONTEXT);
			const tools = await PiToolAdapter.create({
				executor: new ModelToolExecutor(fixture.ports),
				evidence: fixture.evidence,
				now,
				isTerminated: () => false,
			});
			const original = await AgentHarness.create(
				{ session, models: fixture.models, model: fixture.faux.getModel(), tools: tools.tools() },
				TODO_CONTEXT,
			);
			const lane = await original.harness.lane("main", TODO_CONTEXT);
			const old = fauxAssistantMessage("old response");
			old.usage = { ...old.usage, input, cacheRead: 0, cacheWrite: 0 };
			await lane.appendMessage(old, TODO_CONTEXT);
			await original.harness.close(TODO_CONTEXT);
			let pending = false;
			fixture.ports.knowledge.checkpointRequested = async () => pending;
			fixture.faux.setResponses([fauxAssistantMessage("no save"), fauxAssistantMessage("no save")]);
			const runtime = await PiArcRuntime.attach({
				session: await fixture.repo.open(session.metadata, TODO_CONTEXT),
				models: fixture.models,
				provider: fixture.faux.provider.id,
				modelId: fixture.faux.getModel().id,
				laneId: "main",
				systemPrompt: "test",
				evidence: fixture.evidence,
				now,
				recoverAuthority: async () => fixture.authority,
				validateKnowledge: async () => {},
				createExecutor: () => new ModelToolExecutor(fixture.ports),
				buildRecoveryEnvelope: async () => "checkpoint",
				pendingCheckpoint: async () => pending,
				boundary: fixture.boundary,
				requestCheckpoint: () => {
					if (input === 928_001) return Promise.reject(new Error("anchor conflict"));
					pending = true;
					return Promise.resolve();
				},
			});
			try {
				await runtime.prompt("ordinary action prompt");
				expect(pending).toBe(input !== 928_001);
				expect(fixture.authority.termination?.terminationReason).toBe("checkpoint_failed");
				expect(fixture.faux.state.callCount).toBe(input >= 968_000 || input === 928_001 ? 0 : 2);
				expect(fixture.playCount).toBe(0);
			} finally {
				await runtime.close();
				await fixture.repo.close(TODO_CONTEXT);
			}
		},
	);

	it("does not reset checkpoint attempt allowance when reattaching", async () => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		for (let attempt = 0; attempt < 2; attempt += 1)
			await fixture.evidence.appendRuntime("context.boundary", now(), {
				phase: "checkpoint.attempt",
				turn: 0,
				observationDigest: "initial",
			});
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "test",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "checkpoint",
			pendingCheckpoint: async () => true,
			boundary: fixture.boundary,
		});
		try {
			await runtime.prompt("unused");
			expect(fixture.authority.termination?.terminationReason).toBe("checkpoint_failed");
			expect(fixture.faux.state.callCount).toBe(0);
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it("propagates cancellation into in-flight model work without continuation and closes cleanly", async () => {
		const fixture = harnessFixture();
		const abort = new AbortController();
		let requested!: () => void;
		const started = new Promise<void>((resolve) => {
			requested = resolve;
		});
		let modelCancelled = false;
		fixture.faux.setResponses([
			async (_context, options) => {
				const signal = options?.signal;
				expect(signal).toBeDefined();
				requested();
				await new Promise<void>((resolve) => {
					const cancelled = () => {
						modelCancelled = true;
						resolve();
					};
					if (signal?.aborted) cancelled();
					else signal?.addEventListener("abort", cancelled, { once: true });
				});
				return fauxAssistantMessage("cancelled", { stopReason: "aborted" });
			},
		]);
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "test",
			evidence: fixture.evidence,
			now,
			signal: abort.signal,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "recover",
			pendingCheckpoint: async () => false,
			boundary: fixture.boundary,
		});
		try {
			const operation = runtime.prompt("start");
			await started;
			abort.abort();
			await operation;
			expect(modelCancelled).toBe(true);
			expect(fixture.authority.termination?.terminationReason).toBe("cancelled");
			expect(fixture.playCount).toBe(0);
			expect(fixture.faux.state.callCount).toBe(1);
		} finally {
			await runtime.close();
		}
	});

	it.each(["before_prompt", "before_accept"])("closes cancellation admission in the %s window", async (window) => {
		const fixture = harnessFixture();
		const abort = new AbortController();
		const append = fixture.evidence.appendRuntime;
		fixture.evidence.appendRuntime = async (type, at, payload) => {
			const result = await append(type, at, payload);
			if (window === "before_accept" && type === "model.requested") abort.abort();
			return result;
		};
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "test",
			evidence: fixture.evidence,
			now,
			signal: abort.signal,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "recover",
			pendingCheckpoint: async () => false,
			boundary: fixture.boundary,
		});
		try {
			if (window === "before_prompt") abort.abort();
			expect(await runtime.prompt("start")).toMatchObject({
				kind: "terminal",
				terminal: { terminationReason: "cancelled" },
			});
			expect(fixture.faux.state.callCount).toBe(0);
			expect(fixture.playCount).toBe(0);
		} finally {
			await runtime.close();
		}
	});

	it("fails a restored over-capacity DeepSeek segment without mutating durable images", async () => {
		const fixture = harnessFixture();
		const faux = fauxProvider({
			provider: "opencode-go",
			models: [{ id: "deepseek-flash", input: ["text", "image"], contextWindow: 1_000_000 }],
		});
		fixture.models.setProvider(faux.provider);
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		const adapter = await PiToolAdapter.create({
			executor: new ModelToolExecutor(fixture.ports),
			evidence: fixture.evidence,
			now,
			isTerminated: () => false,
		});
		const preflight = await AgentHarness.create(
			{
				session,
				models: fixture.models,
				model: faux.getModel(),
				tools: adapter.tools(),
				toolExecution: "sequential",
			},
			TODO_CONTEXT,
		);
		const lane = await preflight.harness.lane("main", TODO_CONTEXT);
		await lane.appendMessage(
			{
				role: "user",
				content: Array.from({ length: 101 }, (_, index) => ({
					type: "image" as const,
					data: `image-${index}`,
					mimeType: "image/png",
				})),
				timestamp: 0,
			},
			TODO_CONTEXT,
		);
		await preflight.harness.close(TODO_CONTEXT);
		const reopened = await fixture.repo.open(session.metadata, TODO_CONTEXT);
		faux.setResponses([
			() => {
				throw new Error("over-capacity context must never reach provider");
			},
		]);
		const runtime = await PiArcRuntime.attach({
			session: reopened,
			models: fixture.models,
			provider: faux.provider.id,
			modelId: faux.getModel().id,
			laneId: "main",
			systemPrompt: "Complete game",
			evidence: fixture.evidence,
			now,
			recoverAuthority: async () => fixture.authority,
			validateKnowledge: async () => {},
			createExecutor: () => new ModelToolExecutor(fixture.ports),
			buildRecoveryEnvelope: async () => "Recovery",
			boundary: fixture.boundary,
			pendingCheckpoint: async () => false,
		});
		try {
			const outcome = await runtime.prompt("Continue");
			expect(outcome.kind).toBe("terminal");
			expect(fixture.authority.termination?.terminationReason).toBe("checkpoint_failed");
			expect(faux.state.callCount).toBe(0);
			expect(fixture.playCount).toBe(0);
			const entries = await reopened.findEntries({ type: "message" }, TODO_CONTEXT);
			expect(JSON.stringify(entries)).toContain('"data":"image-0"');
			expect(JSON.stringify(entries)).toContain('"data":"image-100"');
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});
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

	it.each([1, 2] as const)("reattaches durable stage %i and its remaining ordinary allowance", async (stage) => {
		const fixture = harnessFixture();
		const session = await fixture.repo.create({}, TODO_CONTEXT);
		const guard = new OrdinaryProgressGuard({ evidence: fixture.evidence, now }, fixture.authority);
		await guard.restore();
		await guard.begin(stage);
		await guard.response(Array.from({ length: 15 }, (_, i) => `before-crash-${i}`));
		let inspected = 0;
		fixture.ports.evidence.readFrame = () => {
			inspected += 1;
			return Promise.resolve({
				turn: 0,
				frame: 0,
				visualRef: "offline",
				visual: { width: 1, height: 1, rgb: Uint8Array.from([0, 0, 0]) },
			});
		};
		fixture.faux.setResponses(
			Array.from({ length: 18 }, () =>
				fauxAssistantMessage(fauxToolCall("inspect", { question: "look", views: [{ label: "v", turn: 0 }] })),
			),
		);
		const runtime = await PiArcRuntime.attach({
			session,
			models: fixture.models,
			provider: fixture.faux.provider.id,
			modelId: fixture.faux.getModel().id,
			laneId: "main",
			systemPrompt: "test",
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
			await runtime.prompt("Must not substitute ordinary prompt after crash");
			expect(fixture.authority.termination?.terminationReason).toBe("model_no_progress");
			expect(fixture.faux.state.callCount).toBe(stage === 1 ? 17 : 1);
			expect(inspected).toBe(stage === 1 ? 17 : 1);
			expect(fixture.authority.turn.turn).toBe(0);
			const entries = await session.findEntries({ type: "message" }, TODO_CONTEXT);
			expect(JSON.stringify(entries)).not.toContain("Must not substitute ordinary prompt after crash");
		} finally {
			await runtime.close();
			await fixture.repo.close(TODO_CONTEXT);
		}
	});

	it.each([8, 15, 16])(
		"allows %i useful inspections, resets at a committed Turn, and continues to WIN",
		async (inspections) => {
			const fixture = harnessFixture();
			const session = await fixture.repo.create({}, TODO_CONTEXT);
			let inspected = 0;
			fixture.ports.evidence.readFrame = () => {
				inspected += 1;
				return Promise.resolve({
					turn: fixture.authority.turn.turn,
					frame: 0,
					visualRef: "offline",
					visual: { width: 1, height: 1, rgb: Uint8Array.from([0, 0, 0]) },
				});
			};
			const play = fixture.ports.play.play;
			fixture.ports.play.play = async (request) => {
				const receipt = await play(request);
				if (fixture.playCount === 2) await fixture.authority.finish("WIN");
				return receipt;
			};
			const inspect = () =>
				fauxAssistantMessage(fauxToolCall("inspect", { question: "look", views: [{ label: "v", turn: 0 }] }));
			const action = () => fauxAssistantMessage(fauxToolCall("play", { action: "ACTION1" }));
			fixture.faux.setResponses([
				...Array.from({ length: inspections }, inspect),
				action(),
				...Array.from({ length: inspections }, inspect),
				action(),
			]);
			const runtime = await PiArcRuntime.attach({
				session,
				models: fixture.models,
				provider: fixture.faux.provider.id,
				modelId: fixture.faux.getModel().id,
				laneId: "main",
				systemPrompt: "test",
				evidence: fixture.evidence,
				now,
				recoverAuthority: async () => fixture.authority,
				validateKnowledge: async () => {},
				createExecutor: () => new ModelToolExecutor(fixture.ports),
				buildRecoveryEnvelope: async () => "Recovered",
				boundary: fixture.boundary,
				pendingCheckpoint: async () => false,
			});
			try {
				await runtime.prompt("Initial");
				// A loop can settle after a committed Action and the next Turn's
				// inspection allowance; the host then supplies its ordinary next prompt.
				if (fixture.authority.termination === null) await runtime.prompt("Continue current Turn");
				expect(fixture.authority.termination?.terminationReason).toBe("WIN");
				expect(fixture.authority.turn.turn).toBe(2);
				expect(inspected).toBe(inspections * 2);
				expect(fixture.playCount).toBe(2);
			} finally {
				await runtime.close();
				await fixture.repo.close(TODO_CONTEXT);
			}
		},
	);

	it.each(["invalid", "inspect", "mixed"])(
		"bounds an endless %s tool loop with one continuation and one fresh context",
		async (mode) => {
			const fixture = harnessFixture();
			const session = await fixture.repo.create({}, TODO_CONTEXT);
			let inspected = 0;
			fixture.ports.evidence.readFrame = () => {
				inspected += 1;
				return Promise.resolve({
					turn: 0,
					frame: 0,
					visualRef: "offline",
					visual: { width: 1, height: 1, rgb: Uint8Array.from([0, 0, 0]) },
				});
			};
			fixture.faux.setResponses(
				Array.from({ length: 49 }, (_, i) =>
					fauxAssistantMessage(
						mode === "invalid" || (mode === "mixed" && i % 2 === 0)
							? fauxToolCall("play", { invalid: true })
							: fauxToolCall("inspect", { question: "look", views: [{ label: "v", turn: 0 }] }),
					),
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
				expect(fixture.authority.termination?.terminationReason).toBe("model_no_progress");
				expect(fixture.authority.turn.turn).toBe(0);
				expect(fixture.playCount).toBe(0);
				expect(fixture.faux.state.callCount).toBe(48);
				expect(inspected).toBe(mode === "invalid" ? 0 : mode === "mixed" ? 24 : 48);
				expect(
					fixture.records.filter((r) => r.eventType === "model.requested" && r.payload.requestId === undefined),
				).toHaveLength(3);
				expect(
					fixture.records.filter((r) => r.eventType === "context.boundary" && r.payload.phase === undefined),
				).toHaveLength(1);
			} finally {
				await runtime.close();
				await fixture.repo.close(TODO_CONTEXT);
			}
		},
	);

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
			expect(
				fixture.records.filter(
					(record) => record.eventType === "context.boundary" && record.payload.phase === undefined,
				),
			).toHaveLength(1);
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
				prepare: async () => (acknowledged ? null : { boundaryId: "reset-7", prompt: "Committed RESET recovery" }),
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
				prepare: async () => (acknowledged ? null : { boundaryId: "reset-7", prompt: "Committed RESET recovery" }),
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
