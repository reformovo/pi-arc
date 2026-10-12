/** Independent synthetic coordinate-contract diagnostic. Never an ARC game or benchmark. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactStore } from "../dist/adapters/artifact-store.js";
import { canonicalJsonDigest } from "../dist/adapters/sha256.js";
import { encodeVisualPng, VisualPngPublisher } from "../dist/adapters/visual-png.js";
import { MODEL_TOOL_DEFINITIONS } from "../dist/application/model-prompts.js";
import { ModelToolExecutor, TOOL_SCHEMA } from "../dist/application/model-tools.js";
import { ArtifactEvidenceReader } from "../dist/composition/artifact-evidence.js";
import { createCliModels } from "../dist/composition/cli-models.js";
import { KnowledgeStore } from "../dist/composition/knowledge-store.js";
import { RuntimeKnowledgeBridge } from "../dist/composition/runtime-knowledge.js";
import { mapAction6Point, renderVisual } from "../dist/domain/game-visual.js";

export const LIMITS = Object.freeze({ requests: 1, output: 4096, timeoutMs: 120_000, retries: 0 });
export const SCOPE =
	"Independent synthetic coordinate-contract test, not an ARC game solution or benchmark. Choose the center of the current green crosshair once using play ACTION6 with the standard 1024x1024 visual coordinates. Recovery history describes already completed actions: do not autoplay or replay it. No other action is requested.";

/** A symmetric, unique bright cross: central intersection is the target, not any arm.
 * @returns {import('../src/domain/game-visual.js').Visual}
 */
export function crossVisual() {
	const rgb = new Uint8Array(1024 * 1024 * 3);
	for (let y = 0; y < 1024; y++) {
		for (let x = 0; x < 1024; x++) {
			const dx = Math.abs(x - 408),
				dy = Math.abs(y - 120);
			const green = (dx <= 4 && dy <= 48) || (dy <= 4 && dx <= 48);
			const outline = (dx <= 7 && dy <= 51) || (dy <= 7 && dx <= 51);
			rgb.set(green ? [0, 255, 0] : outline ? [255, 255, 255] : [16, 16, 16], (y * 1024 + x) * 3);
		}
	}
	return { width: 1024, height: 1024, rgb };
}

/** Only the public CLI-model composition; no deprecated credential fallback.
 * @param {{OPENAI_BASE_URL?: string, OPENAI_API_KEY?: string}} env
 */
export function officialModels(env) {
	let url;
	try {
		url = new URL(env.OPENAI_BASE_URL || "invalid");
	} catch {
		throw new Error("official_endpoint_required");
	}
	if (
		url.protocol !== "https:" ||
		url.hostname !== "api.deepseek.com" ||
		url.port ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!["/", "/v1", "/v1/"].includes(url.pathname)
	)
		throw new Error("official_endpoint_required");
	if (!env.OPENAI_API_KEY) throw new Error("official_auth_required");
	return createCliModels({ OPENAI_BASE_URL: url.href, OPENAI_API_KEY: env.OPENAI_API_KEY });
}

/** Real ledger and raw-frame evidence, synthetic in-process state, no manifest/terminal/WIN.
 * @param {string} root
 */
export async function createFixture(root) {
	const artifacts = new ArtifactStore(root);
	const visual = crossVisual();
	const now = () => "2026-09-24T00:00:00Z";
	const observation = {
		state: /** @type {const} */ ("NOT_FINISHED"),
		levelsCompleted: 0,
		winLevels: 1,
		availableActions: [/** @type {const} */ ("ACTION6")],
		synthetic: true,
		notGame: true,
	};
	/** @type {import('../src/application/run-controller.js').Turn} */
	let turn = {
		turn: 0,
		level: 1,
		attempt: 1,
		attemptStatus: "active",
		actionId: null,
		observation,
		observationDigest: canonicalJsonDigest(observation),
	};
	const pixels = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 5));
	for (let y = 4; y <= 10; y++) {
		const row = pixels[y];
		if (!row) throw new Error("synthetic_frame_invalid");
		for (let x = 22; x <= 28; x++) if (x === 25 || y === 7) row[x] = 14;
	}
	/** @param {import('../src/application/model-tools.js').ToolAction} action @param {string} actionId */
	async function commit(action, actionId) {
		const base = turn;
		await artifacts.appendDomain("action.intent", now(), {
			actionId,
			invocationId: actionId,
			environmentInstanceId: "synthetic-env",
			baseTurn: base.turn,
			baseObservationDigest: base.observationDigest,
			action,
			retryState: null,
		});
		const receipt = {
			actionId,
			status: "complete",
			environmentInstanceId: "synthetic-env",
			baseTurn: base.turn,
			baseObservationDigest: base.observationDigest,
			action,
			turn: base.turn + 1,
			observation,
			frames: [pixels],
			resultState: observation.state,
		};
		const receiptDigest = canonicalJsonDigest(receipt);
		await artifacts.appendDomain("environment.receipt", now(), { ...receipt, receiptDigest });
		turn = { ...base, turn: receipt.turn, actionId };
		const framePath = await artifacts.writeRawFrame({
			schema: "pi-arc.raw-frame.v1",
			width: 64,
			height: 64,
			pixels,
			runId: "synthetic-not-game",
			environmentInstanceId: "synthetic-env",
			turn: turn.turn,
			frame: 0,
			actionId,
			contentDigest: canonicalJsonDigest({ width: 64, height: 64, pixels }),
		});
		const visualRef = await new VisualPngPublisher(root).publish(turn.turn, 0, renderVisual(pixels));
		await artifacts.writeVisualReference({ visualRef, framePath, turn: turn.turn, frame: 0 });
		await artifacts.appendDomain("turn.commit", now(), { ...turn, receiptDigest });
	}
	await artifacts.appendDomain("run.binding", now(), {
		runId: "synthetic-not-game",
		environmentInstanceId: "synthetic-env",
		synthetic: true,
		notGame: true,
	});
	await artifacts.appendDomain("turn.commit", now(), { ...turn, receiptDigest: null });
	await commit({ name: "ACTION6", data: { x: 25, y: 7 } }, "synthetic-source");
	const evidence = new ArtifactEvidenceReader(root, artifacts);
	await evidence.readFrame(1, 0); // verifies stored raw-frame digest before constructing recovery
	const knowledge = new KnowledgeStore(root, artifacts, () => turn.observationDigest, now);
	const bridge = new RuntimeKnowledgeBridge(artifacts, knowledge);
	const authority = {
		get turn() {
			return turn;
		},
		runId: "synthetic-not-game",
		environmentInstanceId: "synthetic-env",
		termination: null,
		finish: () => Promise.reject(new Error("synthetic_not_game")),
	};
	const envelope = await bridge.recoveryEnvelope(
		/** @type {import('../src/composition/pi-runtime.js').RuntimeAuthority} */ (authority),
	);
	/** @type {import('../src/application/model-tools.js').ToolAction[]} */
	const effects = [];
	const executor = new ModelToolExecutor({
		knowledge,
		evidence,
		digest: canonicalJsonDigest,
		anchor: () => turn.observationDigest,
		isTerminated: () => false,
		play: {
			play: async ({ action, invocationId }) => {
				effects.push(action);
				await commit(action, invocationId);
				return {
					result: {
						...observation,
						turn: turn.turn,
						attempt: 1,
						level: 1,
						frameCount: 1,
						visualRef: "synthetic-not-game",
						observationDigest: turn.observationDigest,
					},
					image: visual,
				};
			},
		},
	});
	return { envelope, visual, executor, effects };
}

/** Settlement gate is before parser/effect admission.
 * @param {Awaited<ReturnType<typeof createFixture>>} fixture
 * @param {{stopReason: string, content: readonly {type: string, name?: string, arguments?: unknown}[]}} response
 */
export async function settle(fixture, response) {
	if (response.stopReason !== "toolUse")
		return { reason: "inconclusive", modelInput: null, native: null, mappingMatches: false, targetHit: false };
	const calls = response.content.filter((part) => part.type === "toolCall");
	if (calls.length !== 1 || calls[0]?.name !== "play")
		return { reason: "inconclusive", modelInput: null, native: null, mappingMatches: false, targetHit: false };
	const args = calls[0].arguments;
	// Scope allows only one click, even though the unchanged public play declaration includes other actions.
	if (!args || typeof args !== "object" || !("action" in args) || args.action !== "ACTION6")
		return { reason: "inconclusive", modelInput: null, native: null, mappingMatches: false, targetHit: false };
	const result = await fixture.executor.execute({
		schema: TOOL_SCHEMA,
		invocationId: "synthetic-model-click",
		name: "play",
		args,
	});
	const native = fixture.effects[0]?.data ?? null;
	const input = /** @type {{x: number, y: number}} */ (/** @type {unknown} */ (args));
	const mappingMatches =
		result.envelope.ok && JSON.stringify(native) === JSON.stringify(mapAction6Point(input.x, input.y));
	return {
		reason: result.envelope.ok ? "completed" : "inconclusive",
		modelInput: result.envelope.ok ? { x: input.x, y: input.y } : null,
		native,
		mappingMatches,
		targetHit: native?.x === 25 && native?.y === 7,
	};
}

/** Live is only accessible via explicit flag; injection stays strictly offline.
 * @param {{live?: boolean, response?: Parameters<typeof settle>[1]}} options
 */
export async function runProbe(options = {}) {
	if (options.live && options.response) throw new Error("live_fixture_forbidden");
	const models = options.live ? officialModels(process.env) : null;
	const model = models?.getModel("deepseek", "deepseek-flash");
	if (models && !model) throw new Error("official_model_unavailable");
	const root = await mkdtemp(path.join(tmpdir(), "pi-arc-coordinate-not-game-"));
	try {
		const fixture = await createFixture(root);
		let response = options.response ?? {
			stopReason: "toolUse",
			content: [{ type: "toolCall", name: "play", arguments: { action: "ACTION6", x: 408, y: 120 } }],
		};
		let usage = null;
		if (models && model) {
			try {
				const actual = await models.completeSimple(
					model,
					{
						systemPrompt: SCOPE,
						messages: [
							{
								role: "user",
								content: [
									{ type: "text", text: fixture.envelope },
									{
										type: "image",
										mimeType: "image/png",
										data: Buffer.from(encodeVisualPng(fixture.visual)).toString("base64"),
									},
								],
								timestamp: Date.now(),
							},
						],
						tools: MODEL_TOOL_DEFINITIONS.filter((tool) => tool.name === "play").map((tool) => ({
							name: tool.name,
							description: tool.description,
							parameters: tool.inputSchema,
						})),
					},
					{
						reasoning: "max",
						maxTokens: LIMITS.output,
						maxRetries: 0,
						timeoutMs: LIMITS.timeoutMs,
						signal: AbortSignal.timeout(LIMITS.timeoutMs),
					},
				);
				response = actual;
				usage = actual.usage;
			} catch {
				response = { stopReason: "error", content: [] };
			}
		}
		return {
			mode: "diagnostic",
			benchmark: false,
			synthetic: true,
			notGame: true,
			identity: models
				? { provider: model?.provider, modelId: model?.id, endpoint: "https://api.deepseek.com", thinking: "max" }
				: { provider: "offline-faux", modelId: "faux-control" },
			requests: models ? 1 : 0,
			limits: LIMITS,
			usage,
			nativeExpected: { x: 25, y: 7 },
			...(await settle(fixture, response)),
		};
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.some((arg) => arg !== "--live") || args.length > 1)
		throw new Error("usage: node scripts/probe-recovery-coordinate.mjs [--live]");
	try {
		console.log(JSON.stringify(await runProbe({ live: args.includes("--live") }), null, 2));
	} catch {
		console.log(
			JSON.stringify({
				mode: "diagnostic",
				benchmark: false,
				synthetic: true,
				notGame: true,
				reason: "inconclusive_configuration_or_fixture",
			}),
		);
		process.exitCode = 1;
	}
}
