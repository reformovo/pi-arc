import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it } from "vitest";
import {
	LIMITS,
	officialModels,
	readVerifiedSource,
	runDiagnostic,
	validateSetupCount,
} from "../../scripts/lib/reset-recovery-diagnostic.mjs";
import { driveLevelOneSetup, MAX_ACTIONS, SETUP_CLICK } from "../../scripts/prepare-level-one-reset-source.mjs";
import { buildReplayPlan, toVisualAction } from "../../scripts/validate-reset-recovery.mjs";
import { ArtifactStore } from "../../src/adapters/artifact-store.js";
import { canonicalJsonDigest } from "../../src/adapters/sha256.js";
import { VisualPngPublisher } from "../../src/adapters/visual-png.js";
import {
	type ControllerEnvironment,
	type GameAction,
	type Observation,
	RunController,
} from "../../src/application/run-controller.js";
import { canonicalJson, type JsonValue } from "../../src/protocol/canonical-json.js";

describe("level-one source setup bounds", () => {
	it("validates explicit counts before opening source artifacts", async () => {
		for (const count of [0, -1, 401, 1.5, NaN, Infinity]) {
			expect(() => validateSetupCount(count)).toThrow("source_count_invalid");
			await expect(readVerifiedSource("not-read", count)).rejects.toThrow("source_count_invalid");
		}
		for (const count of [1, 179, 400]) expect(validateSetupCount(count)).toBe(count);
	});

	function driver(endAt: number, progressAt = Infinity) {
		const actions: GameAction[] = [];
		const turn = {
			level: 1,
			observation: { state: "NOT_FINISHED", levelsCompleted: 0, availableActions: ["ACTION6"] },
		};
		return {
			actions,
			controller: {
				turn,
				async play(request: { action: GameAction }) {
					actions.push(request.action);
					if (actions.length >= endAt) turn.observation.state = "GAME_OVER";
					if (actions.length >= progressAt) turn.observation.levelsCompleted = 1;
					await Promise.resolve();
				},
			} as unknown as RunController,
		};
	}

	it("uses only fixed native clicks and accepts GAME_OVER at the action bound", async () => {
		const fixture = driver(MAX_ACTIONS);
		expect(await driveLevelOneSetup(fixture.controller)).toBe(MAX_ACTIONS);
		expect(fixture.actions).toEqual(
			Array.from({ length: MAX_ACTIONS }, () => ({ name: "ACTION6", data: { ...SETUP_CLICK } })),
		);
	});

	it("fails immediately on level progress, including the terminal action", async () => {
		for (const endAt of [1, 5]) {
			const fixture = driver(endAt, 1);
			await expect(driveLevelOneSetup(fixture.controller)).rejects.toThrow("setup_level_progressed");
			expect(fixture.actions).toHaveLength(1);
		}
	});

	it("does not submit action 257 if GAME_OVER is not reached", async () => {
		const fixture = driver(Infinity);
		await expect(driveLevelOneSetup(fixture.controller)).rejects.toThrow("setup_action_limit_exceeded");
		expect(fixture.actions).toHaveLength(MAX_ACTIONS);
	});
});

describe("targeted RESET/recovery replay plan", () => {
	it("maps native ACTION6 coordinates to visual centers without changing other actions", () => {
		expect(toVisualAction({ name: "ACTION6", data: { x: 0, y: 63 } })).toEqual({ action: "ACTION6", x: 8, y: 1016 });
		expect(toVisualAction({ name: "ACTION1", data: {} })).toEqual({ action: "ACTION1" });
	});

	it("appends exactly one minimal retry state after the recorded setup", () => {
		const plan = buildReplayPlan(
			Array.from({ length: 179 }, (_, i) => ({
				name: i % 2 ? "ACTION1" : "ACTION6",
				data: i % 2 ? {} : { x: 1, y: 2 },
			})),
		);
		expect(plan).toHaveLength(180);
		expect(plan.at(-1)).toMatchObject({ action: "RESET" });
		const reset = plan.at(-1);
		if (!reset || !("retry_state" in reset)) throw new Error("missing reset state");
		expect(reset.retry_state).toContain("No solution is supplied");
	});
});

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function temp() {
	const root = await mkdtemp(path.join(os.tmpdir(), "reset-diagnostic-test-"));
	roots.push(root);
	return root;
}
const game = { id: "ft09-fixture", sourceLocator: "fixture://offline", treeDigest: "a".repeat(64) };
class DeterministicEnvironment implements ControllerEnvironment {
	turn = 0;
	closed = false;
	observation: Observation = {
		state: "NOT_FINISHED",
		levelsCompleted: 0,
		winLevels: 1,
		availableActions: ["ACTION6"],
	};
	readonly actions: GameAction[] = [];
	readonly receipts = new Map<string, Record<string, JsonValue>>();
	constructor(
		readonly id: string,
		readonly mismatch = false,
	) {}
	async open() {
		await Promise.resolve();
		return {
			environmentInstanceId: this.id,
			anchor: { environmentInstanceId: this.id, turn: 0, observationDigest: canonicalJsonDigest(this.observation) },
			observation: this.observation,
			frames: [
				[
					[0, 1],
					[2, 3],
				],
			],
		};
	}
	async request(type: "get_anchor" | "lookup_action" | "submit_action", payload: Record<string, unknown>) {
		await Promise.resolve();
		const id = String(payload.actionId);
		if (type !== "submit_action") return { receipt: this.receipts.get(id) };
		const action = payload.action as GameAction;
		this.actions.push(action);
		this.turn++;
		this.observation = { ...this.observation, state: this.turn === 1 ? "GAME_OVER" : "NOT_FINISHED" };
		const body = {
			actionId: id,
			status: "complete",
			environmentInstanceId: this.id,
			baseTurn: this.turn - 1,
			baseObservationDigest: payload.baseObservationDigest as string,
			action,
			turn: this.turn,
			observation: this.observation,
			frames: [
				[
					[this.mismatch ? 7 : this.turn % 16, 1],
					[2, 3],
				],
			],
			resultState: this.observation.state,
		};
		const receipt = { ...body, receiptDigest: canonicalJsonDigest(body) };
		this.receipts.set(id, receipt);
		return { receipt };
	}
	async close() {
		await Promise.resolve();
		this.closed = true;
	}
}
async function fixture() {
	const root = await temp();
	const source = new ArtifactStore(root);
	const controller = await RunController.start(
		{
			manifest: { schema: "pi-arc.run-manifest.v1", runId: "source-fixture", game, seed: 42 },
			sessionId: "offline",
			laneId: "arc",
		},
		{
			artifacts: source,
			environment: new DeterministicEnvironment("source-instance"),
			visuals: new VisualPngPublisher(root),
			now: () => "2026-01-01T00:00:00Z",
			digest: canonicalJsonDigest,
		},
	);
	await controller.play({
		actionId: "source-action",
		invocationId: "source-action",
		action: { name: "ACTION6", data: { x: 4, y: 5 } },
	});
	const faux = fauxProvider({ models: [{ id: "offline", input: ["text", "image"], reasoning: true }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const environment = new DeterministicEnvironment("fresh-instance");
	const ports = {
		models,
		provider: faux.provider.id,
		modelId: "offline",
		setupCount: 1,
		environment,
		resolveGame: () =>
			Promise.resolve({
				gameId: game.id,
				sourceLocator: game.sourceLocator,
				treeDigest: game.treeDigest,
				contentRoot: root,
				environmentRoot: root,
				manifest: {
					schema: "pi-arc.game-cache.v1" as const,
					sourceLocator: game.sourceLocator,
					gameId: game.id,
					sdkVersion: "0.9.9" as const,
					runtimeVersion: "3.12.9" as const,
					seed: 42 as const,
					treeDigest: game.treeDigest,
					entries: [],
				},
				cacheHit: true,
			}),
	};
	return { root, source, faux, environment, ports, output: await temp() };
}

describe("diagnostic authority and live boundary (offline fixtures only)", () => {
	it("joins complete receipts and commits, rejecting intentions-only false proof", async () => {
		const f = await fixture();
		expect((await readVerifiedSource(path.join(f.root, "domain.jsonl"), 1)).actions).toHaveLength(1);
		const records = (await f.source.readDomain()).filter(
			(r) => r.recordType !== "environment.receipt" && !(r.recordType === "turn.commit" && r.payload.actionId),
		);
		let previous = "0".repeat(64);
		const rewritten = records.map((r, i) => {
			const { digest: _digest, ...body } = r;
			const record = { ...body, sequence: i + 1, previousDigest: previous };
			previous = canonicalJsonDigest(record);
			return { ...record, digest: previous };
		});
		await writeFile(path.join(f.root, "domain.jsonl"), `${rewritten.map(canonicalJson).join("\n")}\n`);
		await expect(readVerifiedSource(path.join(f.root, "domain.jsonl"), 1)).rejects.toThrow(
			"source_completion_missing",
		);
	});

	it("replays native setup, RESET without available RESET, then validates visual model coordinates and one-play gate", async () => {
		const f = await fixture();
		f.faux.setResponses([
			(context, options, _state, model) => {
				expect(options).toMatchObject({ reasoning: "max", maxTokens: 1024, maxRetries: 0, timeoutMs: 120000 });
				const wire = JSON.stringify(context);
				expect(wire).toContain("visual_1024");
				expect(wire).toContain("not the original model input");
				expect(wire).toContain("game_actions");
				expect(wire).toContain('\\"attempt\\":2');
				expect(wire).not.toContain("source-instance");
				expect(model.provider).toBe(f.faux.provider.id);
				return fauxAssistantMessage(
					[
						fauxToolCall("play", { action: "ACTION6", x: 72, y: 88 }),
						fauxToolCall("play", { action: "ACTION6", x: 72, y: 88 }),
						fauxToolCall("history", {}),
					],
					{ stopReason: "toolUse" },
				);
			},
		]);
		const report = await runDiagnostic(
			{ domainPath: path.join(f.root, "domain.jsonl"), artifactRoot: f.output },
			{ ...f.ports, requests: 1 },
		);
		expect(report.setup).toMatchObject({
			origin: "driver-replay",
			actions: 1,
			resetActions: 1,
			reachedGameOver: true,
		});
		expect(report.model).toMatchObject({ provider: f.faux.provider.id, requests: 1, actions: 1 });
		expect(report.audit?.ok).toBe(true);
		expect(report.terminationReason).toBe("model_no_progress");
		expect(f.environment.closed).toBe(true);
		expect(f.environment.actions).toEqual([
			{ name: "ACTION6", data: { x: 4, y: 5 } },
			{ name: "RESET", data: {} },
			{ name: "ACTION6", data: { x: 4, y: 5 } },
		]);
		const store = new ArtifactStore(f.output);
		expect((await store.readRuntime()).filter((r) => r.payload.code === "observation_required")).toHaveLength(2);
		const manifest = JSON.parse(await readFile(path.join(f.output, "manifest.json"), "utf8"));
		expect(manifest.model).toMatchObject({
			provider: f.faux.provider.id,
			validationMode: "diagnostic-fixture",
			setupOrigin: { setupActionIds: ["driver-replay-1"] },
		});
		expect((await readFile(path.join(f.output, "diagnostic-current.png"))).subarray(0, 8).toString("hex")).toBe(
			"89504e470d0a1a0a",
		);
	});

	it("allows one bounded larger response and records actual coordinate mapping", async () => {
		const f = await fixture();
		f.faux.setResponses([
			(_context, options) => {
				expect(options?.maxTokens).toBe(8192);
				expect(options?.timeoutMs).toBe(300_000);
				return fauxAssistantMessage(fauxToolCall("play", { action: "ACTION6", x: 72, y: 88 }), {
					stopReason: "toolUse",
				});
			},
		]);
		const report = await runDiagnostic(
			{
				domainPath: path.join(f.root, "domain.jsonl"),
				artifactRoot: f.output,
				maxRequests: 1,
				maxOutputTokens: 8192,
				callTimeoutMs: 300_000,
			},
			f.ports,
		);
		expect(report.model.requests).toBe(1);
		expect(report.model.coordinateChecks).toEqual([
			{ modelX: 72, modelY: 88, nativeX: 4, nativeY: 5, mappingMatches: true },
		]);
		expect(report.audit?.ok).toBe(true);
	});

	it("rejects larger total output budget before reading source or calling models", async () => {
		await expect(runDiagnostic({ domainPath: "not-read", maxRequests: 2, maxOutputTokens: 8192 })).rejects.toThrow(
			"diagnostic_limits_invalid",
		);
	});

	it("records real-world integer usage without floating cost and preserves truncation reason", async () => {
		const f = await fixture();
		const response = fauxAssistantMessage("thinking was truncated", { stopReason: "length" });
		response.usage = {
			input: 18_859,
			output: 1024,
			cacheRead: 2176,
			cacheWrite: 0,
			reasoning: 1024,
			totalTokens: 22_059,
			cost: { input: 0.0056577, output: 0.0012288, cacheRead: 0.000013056, cacheWrite: 0, total: 0.006899556 },
		};
		f.faux.setResponses([response]);
		const report = await runDiagnostic(
			{ domainPath: path.join(f.root, "domain.jsonl"), artifactRoot: f.output },
			{ ...f.ports, requests: 1 },
		);
		expect(report.diagnosticReason).toBe("model_length");
		expect(report.model.actions).toBe(0);
		expect(report.audit?.ok).toBe(true);
		const records = await new ArtifactStore(f.output).readRuntime();
		const settled = records.find((record) => record.eventType === "model.responded");
		expect(settled?.payload.stopReason).toBe("length");
		expect(settled?.payload.usage).not.toHaveProperty("cost");
	});

	it.each(["length", "error", "aborted"] as const)("does not execute partial tools for %s", async (stopReason) => {
		const f = await fixture();
		f.faux.setResponses([
			fauxAssistantMessage(fauxToolCall("play", { action: "ACTION6", x: 72, y: 88 }), { stopReason }),
		]);
		const report = await runDiagnostic(
			{ domainPath: path.join(f.root, "domain.jsonl"), artifactRoot: f.output },
			{ ...f.ports, requests: 1 },
		);
		expect(report.model.actions).toBe(0);
		expect(report.terminationReason).toBe("model_failure");
		expect(f.environment.actions).toHaveLength(2);
		expect(f.environment.closed).toBe(true);
	});

	it("caps no-progress requests and the controller's combined action budget", async () => {
		const f = await fixture();
		f.faux.setResponses(Array.from({ length: 9 }, () => fauxAssistantMessage("still observing")));
		const report = await runDiagnostic(
			{ domainPath: path.join(f.root, "domain.jsonl"), artifactRoot: f.output },
			{ ...f.ports, requests: 999 },
		);
		expect(report.model.requests).toBe(8);
		expect(report.model.actions).toBe(0);
		expect(report.limits.actions).toBe(12);
		expect(JSON.parse(await readFile(path.join(f.output, "manifest.json"), "utf8")).config.actionBudget).toBe(14);
		expect(LIMITS.requests).toBe(8);
	});

	it("fails closed on replay mismatch and closes the environment before model requests", async () => {
		const f = await fixture();
		const environment = new DeterministicEnvironment("fresh", true);
		const report = await runDiagnostic(
			{ domainPath: path.join(f.root, "domain.jsonl"), artifactRoot: f.output },
			{ ...f.ports, environment },
		);
		expect(report.model.requests).toBe(0);
		expect(report.setup.reachedGameOver).toBe(false);
		expect(report.terminationReason).toBe("controller_failure");
		expect(environment.closed).toBe(true);
	});

	it("preserves initial and inspect images unchanged in the next model request", async () => {
		const f = await fixture();
		f.faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall("inspect", { question: "What changed?", views: [{ label: "current", turn: 2 }] }),
				{ stopReason: "toolUse" },
			),
			(context) => {
				const first = context.messages.find((m) => m.role === "user");
				const result = context.messages.find((m) => m.role === "toolResult");
				expect(
					first && Array.isArray(first.content) && first.content.filter((c) => c.type === "image"),
				).toHaveLength(1);
				expect(result?.content.filter((c) => c.type === "image")).toHaveLength(1);
				return fauxAssistantMessage("observing");
			},
		]);
		const report = await runDiagnostic(
			{ domainPath: path.join(f.root, "domain.jsonl"), artifactRoot: f.output },
			{ ...f.ports, requests: 2 },
		);
		expect(report.model.requestImageCounts).toEqual([1, 2]);
		expect(report.audit?.ok).toBe(true);
	});

	it("stops before HTTP beyond the diagnostic image cap without deleting images", async () => {
		const f = await fixture();
		const views = Array.from({ length: 16 }, (_, i) => ({ label: `view-${i}`, turn: 2 }));
		f.faux.setResponses(
			Array.from({ length: 5 }, () =>
				fauxAssistantMessage(fauxToolCall("inspect", { question: "Compare these views", views }), {
					stopReason: "toolUse",
				}),
			),
		);
		const report = await runDiagnostic(
			{ domainPath: path.join(f.root, "domain.jsonl"), artifactRoot: f.output },
			f.ports,
		);
		expect(report.model.requests).toBe(4);
		expect(report.model.requestImageCounts).toEqual([1, 17, 33, 49]);
		expect(report.diagnosticReason).toBe("diagnostic_image_limit");
		expect(report.terminationReason).toBe("model_no_progress");
		expect(f.environment.closed).toBe(true);
	}, 20000);

	it("counts invalid and rejected tools against the total sixteen-tool cap", async () => {
		const f = await fixture();
		f.faux.setResponses(
			Array.from({ length: 2 }, () =>
				fauxAssistantMessage(
					Array.from({ length: 10 }, () => fauxToolCall("play", { action: "ACTION6", x: -1, y: 88 })),
					{ stopReason: "toolUse" },
				),
			),
		);
		const report = await runDiagnostic(
			{ domainPath: path.join(f.root, "domain.jsonl"), artifactRoot: f.output },
			f.ports,
		);
		expect(report.model.toolCalls).toBe(16);
		expect(report.model.actions).toBe(0);
		expect(report.model.requests).toBe(2);
		expect(report.diagnosticReason).toBe("tool_budget_exhausted");
		expect(report.audit?.ok).toBe(true);
	});

	it("rejects nonofficial endpoints without including keys or endpoint text", () => {
		for (const endpoint of [
			"https://example.invalid",
			"http://api.deepseek.com",
			"https://key@api.deepseek.com",
			"https://api.deepseek.com/?secret=x",
		]) {
			expect(() => officialModels({ OPENAI_BASE_URL: endpoint, OPENAI_API_KEY: "secret" })).toThrow(
				"official_endpoint_required",
			);
		}
	});
});
