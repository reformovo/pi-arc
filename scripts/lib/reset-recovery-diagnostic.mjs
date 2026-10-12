/** Standalone diagnostic composition; compiled production components, no SDK additions. */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactStore } from "../../dist/adapters/artifact-store.js";
import { GAME_SEED, GameResolver } from "../../dist/adapters/game-resolver.js";
import { canonicalJsonDigest } from "../../dist/adapters/sha256.js";
import { SidecarClient } from "../../dist/adapters/sidecar-client.js";
import { encodeVisualPng, VisualPngPublisher } from "../../dist/adapters/visual-png.js";
import { MODEL_TOOL_DEFINITIONS, NONTERMINAL_CONTINUATION_PROMPT } from "../../dist/application/model-prompts.js";
import { ModelToolExecutor, RESULT_SCHEMA, TOOL_SCHEMA } from "../../dist/application/model-tools.js";
import { RunController } from "../../dist/application/run-controller.js";
import { ArtifactEvidenceReader } from "../../dist/composition/artifact-evidence.js";
import { createCliModels } from "../../dist/composition/cli-models.js";
import { controllerPlayPort } from "../../dist/composition/controller-play.js";
import { KnowledgeStore } from "../../dist/composition/knowledge-store.js";
import { loadModelSystemPrompt } from "../../dist/composition/prompt-loader.js";
import { RuntimeKnowledgeBridge } from "../../dist/composition/runtime-knowledge.js";
import { canonicalJson } from "../../dist/protocol/canonical-json.js";

export const LIMITS = Object.freeze({
	requests: 8,
	actions: 12,
	tools: 16,
	images: 64,
	output: 1024,
	callMs: 120_000,
	globalMs: 720_000,
});
const RETRY_STATE =
	"Recovery validation: continue from the new attempt using the current 1024x1024 coordinate contract. No solution is supplied; inspect the fresh observation and available actions.";
/** @typedef {import('../../src/protocol/canonical-json.js').JsonValue} JsonValue */
/** @typedef {import('../../src/application/run-controller.js').GameAction} GameAction */

/** Verify the hash chain AND join intent -> complete receipt -> commit. Intents alone never authorize replay. */
/** @param {unknown} count @returns {number} */
export function validateSetupCount(count) {
	if (!Number.isSafeInteger(count) || /** @type {number} */ (count) < 1 || /** @type {number} */ (count) > 400)
		throw new Error("source_count_invalid");
	return /** @type {number} */ (count);
}
/** @param {string} domainPath @param {number} count */
export async function readVerifiedSource(domainPath, count = 179) {
	validateSetupCount(count);
	if (path.basename(domainPath) !== "domain.jsonl") throw new Error("source_domain_invalid");
	const root = path.dirname(domainPath);
	const store = new ArtifactStore(root);
	const records = await store.readDomain();
	const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
	const binding = records.find((r) => r.recordType === "run.binding");
	if (
		manifest.seed !== GAME_SEED ||
		!manifest.game ||
		typeof manifest.game.id !== "string" ||
		typeof manifest.game.sourceLocator !== "string" ||
		typeof manifest.game.treeDigest !== "string"
	)
		throw new Error("source_manifest_invalid");
	if (
		!binding ||
		canonicalJson(binding.payload.game ?? null) !== canonicalJson(manifest.game ?? null) ||
		binding.payload.runId !== manifest.runId
	)
		throw new Error("source_binding_invalid");
	const evidence = new ArtifactEvidenceReader(root, store);
	const initial = records.find((r) => r.recordType === "turn.commit" && r.payload.turn === 0);
	if (
		!initial ||
		initial.payload.actionId !== null ||
		initial.payload.observationDigest !== canonicalJsonDigest(initial.payload.observation ?? null)
	)
		throw new Error("source_initial_invalid");
	/** @type {{action: GameAction, observation: JsonValue, frames: JsonValue, sourceActionId: string}[]} */
	const actions = [];
	let previous = initial.payload;
	for (const intent of records.filter((r) => r.recordType === "action.intent").slice(0, count)) {
		const p = intent.payload;
		const receipts = records.filter(
			(r) => r.recordType === "environment.receipt" && r.payload.actionId === p.actionId,
		);
		const commits = records.filter((r) => r.recordType === "turn.commit" && r.payload.actionId === p.actionId);
		const receipt = receipts[0];
		const commit = commits[0];
		if (receipts.length !== 1 || commits.length !== 1 || !receipt || !commit)
			throw new Error("source_completion_missing");
		const r = receipt.payload;
		const c = commit.payload;
		const { receiptDigest, ...digestable } = r;
		if (
			intent.sequence >= receipt.sequence ||
			receipt.sequence >= commit.sequence ||
			r.status !== "complete" ||
			p.environmentInstanceId !== binding.payload.environmentInstanceId ||
			r.environmentInstanceId !== p.environmentInstanceId ||
			p.baseTurn !== previous.turn ||
			p.baseObservationDigest !== previous.observationDigest ||
			r.baseTurn !== p.baseTurn ||
			r.baseObservationDigest !== p.baseObservationDigest ||
			r.turn !== Number(p.baseTurn) + 1 ||
			c.turn !== r.turn ||
			receiptDigest !== canonicalJsonDigest(digestable) ||
			c.receiptDigest !== receiptDigest ||
			canonicalJson(r.action ?? null) !== canonicalJson(p.action ?? null) ||
			canonicalJson(r.observation ?? null) !== canonicalJson(c.observation ?? null) ||
			c.observationDigest !== canonicalJsonDigest(c.observation ?? null) ||
			typeof p.actionId !== "string"
		)
			throw new Error("source_completion_invalid");
		const action = /** @type {GameAction} */ (p.action);
		// Use the existing model projection to validate native click coordinates; native evidence stays unchanged.
		if (!action || !/^ACTION[1-7]$/.test(action.name) || !action.data) throw new Error("source_action_invalid");
		if (action.name === "ACTION6") {
			if (
				Object.keys(action.data).sort().join() !== "x,y" ||
				![action.data.x, action.data.y].every(
					(v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 64,
				)
			)
				throw new Error("source_action_invalid");
		} else if (Object.keys(action.data).length) throw new Error("source_action_invalid");
		if (
			!Array.isArray(r.frames) ||
			!r.frames.length ||
			r.resultState !== /** @type {{state?: JsonValue}} */ (r.observation).state
		)
			throw new Error("source_receipt_invalid");
		for (let frame = 0; frame < r.frames.length; frame++) await evidence.readFrame(Number(c.turn), frame);
		actions.push({ action, observation: r.observation ?? null, frames: r.frames, sourceActionId: p.actionId });
		previous = c;
	}
	if (actions.length !== count) throw new Error("source_count_incomplete");
	const initialFrame = await evidence.readFrame(0, null);
	return {
		actions,
		digest: canonicalJsonDigest([...records]),
		game: manifest.game,
		initialObservation: initial.payload.observation ?? null,
		initialVisual: initialFrame.visual,
	};
}

/** Official-only guard. Never fall back to OpenCode-Go or leak the endpoint/key in errors. */
/** @param {{OPENAI_BASE_URL?: string, OPENAI_API_KEY?: string}} env */
export function officialModels(env) {
	let url;
	try {
		url = new URL(env.OPENAI_BASE_URL || "https://api.deepseek.com");
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
		!["", "/", "/v1", "/v1/"].includes(url.pathname)
	)
		throw new Error("official_endpoint_required");
	if (!env.OPENAI_API_KEY) throw new Error("official_auth_required");
	return createCliModels({ OPENAI_BASE_URL: url.href, OPENAI_API_KEY: env.OPENAI_API_KEY });
}

/** @typedef {{domainPath: string, artifactRoot?: string | undefined, gameCache?: string | undefined, live?: boolean, setupCount?: number, maxRequests?: number, maxOutputTokens?: number, callTimeoutMs?: number}} Settings */
/** Test injection is explicit: fixture identities remain faux and are never labeled official. */
/** @typedef {{models: import('@earendil-works/pi-ai').Models, provider: string, modelId: string, setupCount?: number, requests?: number, resolveGame: () => Promise<import('../../src/adapters/game-resolver.js').ResolvedGame>, environment: import('../../src/application/run-controller.js').ControllerEnvironment & {close(): Promise<void>}}} Fixture */
/** @param {Settings} settings @param {Fixture | undefined} fixture */
export async function runDiagnostic(settings, fixture = undefined) {
	const limits = {
		...LIMITS,
		requests: settings.maxRequests ?? LIMITS.requests,
		output: settings.maxOutputTokens ?? LIMITS.output,
		callMs: settings.callTimeoutMs ?? LIMITS.callMs,
	};
	if (
		!Number.isSafeInteger(limits.requests) ||
		limits.requests < 1 ||
		limits.requests > LIMITS.requests ||
		!Number.isSafeInteger(limits.output) ||
		limits.output < 1 ||
		limits.output > 8192 ||
		limits.requests * limits.output > LIMITS.requests * LIMITS.output ||
		!Number.isSafeInteger(limits.callMs) ||
		limits.callMs < 1 ||
		limits.callMs > 300_000
	)
		throw new Error("diagnostic_limits_invalid");
	const source = await readVerifiedSource(
		settings.domainPath,
		validateSetupCount(fixture?.setupCount ?? settings.setupCount ?? 179),
	);
	const root = path.resolve(settings.artifactRoot ?? "run-artifacts/ft09-reset-recovery");
	await mkdir(root, { recursive: true });
	if ((await readdir(root)).length) throw new Error("diagnostic_root_not_empty");
	const models = fixture?.models ?? officialModels(process.env);
	const provider = fixture?.provider ?? "deepseek";
	const modelId = fixture?.modelId ?? "deepseek-flash";
	const model = models.getModel(provider, modelId);
	if (
		!model ||
		(!fixture &&
			(model.provider !== "deepseek" ||
				model.id !== "deepseek-flash" ||
				new URL(model.baseUrl).hostname !== "api.deepseek.com"))
	)
		throw new Error("diagnostic_model_unavailable");
	if (!fixture && !source.game.id.startsWith("ft09-")) throw new Error("source_game_invalid");
	const game = fixture
		? await fixture.resolveGame()
		: await new GameResolver({ fetch: () => Promise.reject(new Error("offline_only")) }).resolve({
				gameId: source.game.id,
				cacheRoot: settings.gameCache ?? "game-cache",
				offline: true,
			});
	if (
		canonicalJson(source.game) !==
		canonicalJson({ id: game.gameId, sourceLocator: game.sourceLocator, treeDigest: game.treeDigest })
	)
		throw new Error("source_cache_binding_mismatch");
	const receipts = await mkdtemp(path.join(os.tmpdir(), "pi-arc-diagnostic-receipts-"));
	const global = new AbortController();
	const timer = setTimeout(() => {
		global.abort();
		// Unblock sidecar I/O too; the controller reconciles any pending Action as unknown.
		void environment?.close().catch(() => undefined);
	}, LIMITS.globalMs);
	const now = () => new Date().toISOString();
	const artifacts = new ArtifactStore(root);
	/** @type {RunController | undefined} */ let controller;
	/** @type {(import('../../src/application/run-controller.js').ControllerEnvironment & {close(): Promise<void>}) | undefined} */ let environment;
	const setupActionIds = source.actions.map((_, i) => `driver-replay-${i + 1}`);
	const setupOrigin = {
		kind: "driver-replay",
		sourceDigest: source.digest,
		setupActionIds,
		resetActionId: "driver-reset",
		completedSourceActions: source.actions.length,
	};
	const requestUsage = [];
	let diagnosticReason = "setup_failed";
	let requests = 0;
	let replayedActions = 0;
	let modelActions = 0;
	/** @type {{modelX: number, modelY: number, nativeX: number, nativeY: number, mappingMatches: boolean}[]} */
	const coordinateChecks = [];
	let toolCalls = 0;
	const requestImageCounts = [];
	let reachedGameOver = false;
	let resetCompleted = false;
	try {
		environment =
			fixture?.environment ??
			new SidecarClient({
				environmentRoot: game.environmentRoot,
				cacheRoot: receipts,
				gameId: game.gameId,
				sourceLocator: game.sourceLocator,
				treeDigest: game.treeDigest,
				seed: GAME_SEED,
				python: fileURLToPath(new URL("../../.venv/bin/python", import.meta.url)),
				pythonPath: fileURLToPath(new URL("../../python", import.meta.url)),
			});
		controller = await RunController.start(
			{
				manifest: {
					schema: "pi-arc.run-manifest.v1",
					runId: randomUUID(),
					game: source.game,
					model: {
						provider,
						modelId,
						thinkingLevel: "max",
						validationMode: fixture ? "diagnostic-fixture" : "diagnostic",
						setupOrigin,
					},
					runtime: { piAgentCore: "0.86.0", piAi: "0.86.0" },
					coordinates: 1024,
					seed: GAME_SEED,
					config: { actionBudget: source.actions.length + 1 + LIMITS.actions, gameOffline: true },
				},
				sessionId: "diagnostic-no-pi-session",
				laneId: "arc",
			},
			{
				artifacts,
				environment,
				visuals: new VisualPngPublisher(root),
				now,
				digest: canonicalJsonDigest,
				actionBudget: source.actions.length + 1 + LIMITS.actions,
				signal: global.signal,
			},
		);
		const evidence = new ArtifactEvidenceReader(root, artifacts);
		if (
			canonicalJson(controller.turn.observation) !== canonicalJson(source.initialObservation) ||
			JSON.stringify((await evidence.readFrame(0, null)).visual) !== JSON.stringify(source.initialVisual)
		)
			throw new Error("initial_replay_mismatch");
		for (const [i, item] of source.actions.entries()) {
			const id = setupActionIds[i];
			if (!id) throw new Error("setup_identity_missing");
			await controller.play({ actionId: id, invocationId: id, action: item.action });
			replayedActions++;
			const receipt = (await artifacts.readDomain()).find(
				(r) => r.recordType === "environment.receipt" && r.payload.actionId === id,
			);
			if (
				!receipt ||
				canonicalJson(receipt.payload.observation ?? null) !== canonicalJson(item.observation) ||
				canonicalJson(receipt.payload.frames ?? null) !== canonicalJson(item.frames)
			)
				throw new Error("setup_replay_mismatch");
		}
		if (controller.turn.observation.state !== "GAME_OVER") throw new Error("setup_game_over_not_reached");
		reachedGameOver = true;
		await controller.play({
			actionId: "driver-reset",
			invocationId: "driver-reset",
			action: { name: "RESET", data: {} },
			retryState: RETRY_STATE,
		});
		resetCompleted = true;
		const authority = controller;
		const anchor = () =>
			canonicalJsonDigest({
				runId: authority.runId,
				environmentInstanceId: authority.environmentInstanceId,
				turn: authority.turn.turn,
				observationDigest: authority.turn.observationDigest,
				level: authority.turn.level,
				attempt: authority.turn.attempt,
			});
		const knowledge = new KnowledgeStore(root, artifacts, anchor, now);
		const bridge = new RuntimeKnowledgeBridge(artifacts, knowledge);
		const executor = new ModelToolExecutor({
			play: controllerPlayPort(controller, evidence),
			evidence,
			knowledge,
			digest: canonicalJsonDigest,
			anchor,
			isTerminated: () => authority.termination !== null,
		});
		const prompt = await loadModelSystemPrompt();
		/** @type {import('@earendil-works/pi-ai').Message[]} */ const messages = [];
		const boundary = await bridge.prepareBoundary(controller);
		const envelope = boundary?.prompt ?? (await bridge.recoveryEnvelope(controller));
		await writeFile(path.join(root, "diagnostic-recovery.txt"), envelope, { flag: "wx", mode: 0o600 });
		await writeFile(
			path.join(root, "diagnostic-current.png"),
			encodeVisualPng((await evidence.readFrame(controller.turn.turn, null)).visual),
			{ flag: "wx", mode: 0o600 },
		);
		diagnosticReason = "model_request_budget_exhausted";
		for (
			let round = 0;
			round < Math.min(fixture?.requests ?? limits.requests, limits.requests) && !controller.termination;
			round++
		) {
			if (global.signal.aborted) {
				diagnosticReason = "global_timeout";
				await controller.cancel();
				break;
			}
			// Preserve all history and images; cap the diagnostic before HTTP, not by truncation.
			const currentFrame = await evidence.readFrame(controller.turn.turn, null);
			messages.push({
				role: "user",
				content: [
					{
						type: "text",
						text:
							round === 0
								? envelope
								: `${NONTERMINAL_CONTINUATION_PROMPT}\n${await bridge.recoveryEnvelope(controller)}`,
					},
					...(round === 0
						? [
								{
									type: /** @type {const} */ ("image"),
									mimeType: "image/png",
									data: Buffer.from(encodeVisualPng(currentFrame.visual)).toString("base64"),
								},
							]
						: []),
				],
				timestamp: Date.now(),
			});
			const imageCount = messages.reduce(
				(count, message) =>
					count +
					(Array.isArray(message.content) ? message.content.filter((part) => part.type === "image").length : 0),
				0,
			);
			if (imageCount > LIMITS.images) {
				diagnosticReason = "diagnostic_image_limit";
				await controller.finish("model_no_progress");
				break;
			}
			requestImageCounts.push(imageCount);
			if (round === 0 && boundary) await bridge.acknowledgeBoundary(boundary.boundaryId);
			await artifacts.appendRuntime("model.requested", now(), {
				provider,
				modelId,
				validationMode: fixture ? "diagnostic-fixture" : "diagnostic",
				request: round + 1,
				outputCap: limits.output,
				imageCount,
			});
			requests++;
			const response = await models.completeSimple(
				model,
				{
					systemPrompt: prompt.systemPrompt,
					messages,
					tools: MODEL_TOOL_DEFINITIONS.map((d) => ({
						name: d.name,
						description: d.description,
						parameters: d.inputSchema,
					})),
				},
				{
					reasoning: "max",
					maxTokens: limits.output,
					maxRetries: 0,
					timeoutMs: limits.callMs,
					signal: AbortSignal.any([global.signal, AbortSignal.timeout(limits.callMs)]),
				},
			);
			if (response.provider !== provider || response.model !== modelId) throw new Error("model_identity_mismatch");
			requestUsage.push(response.usage);
			await artifacts.appendRuntime("model.responded", now(), {
				provider,
				modelId,
				request: requests,
				stopReason: response.stopReason,
				// Canonical runtime records accept integers only; catalog cost estimates are floats.
				usage: {
					input: response.usage.input,
					output: response.usage.output,
					cacheRead: response.usage.cacheRead,
					cacheWrite: response.usage.cacheWrite,
					totalTokens: response.usage.totalTokens,
					...(response.usage.reasoning === undefined ? {} : { reasoning: response.usage.reasoning }),
				},
			});
			if (!["stop", "toolUse"].includes(response.stopReason)) {
				diagnosticReason = `model_${response.stopReason}`;
				await controller.finish(global.signal.aborted ? "cancelled" : "model_failure");
				break;
			}
			messages.push(response);
			const calls = response.content.filter((c) => c.type === "toolCall");
			if (!calls.length) {
				messages.push({ role: "user", content: NONTERMINAL_CONTINUATION_PROMPT, timestamp: Date.now() });
				continue;
			}
			if (response.stopReason !== "toolUse" || calls.length > LIMITS.tools) {
				diagnosticReason = "tool_sequence_invalid";
				await controller.finish("model_failure");
				break;
			}
			let played = false;
			for (const [index, call] of calls.entries()) {
				if (toolCalls >= LIMITS.tools) {
					diagnosticReason = "tool_budget_exhausted";
					await controller.finish("model_no_progress");
					break;
				}
				toolCalls++;
				const invocationId = `model-${round + 1}-${index + 1}`;
				const name = /** @type {import('../../src/application/model-tools.js').ToolName} */ (call.name);
				/** @type {import('../../src/application/model-tools.js').ToolExecution} */ let executed;
				if (played)
					executed = {
						envelope: {
							schema: RESULT_SCHEMA,
							invocationId,
							name,
							ok: false,
							error: {
								code: "observation_required",
								message: "Observe the play result before another tool call",
							},
						},
						images: [],
					};
				else {
					if (name === "play") {
						played = true;
						await artifacts.appendRuntime("tool.admitted", now(), {
							name,
							invocationId,
							turnId: `request-${round + 1}`,
						});
					}
					const before = controller.turn.turn;
					executed = await executor.execute({
						schema: TOOL_SCHEMA,
						invocationId,
						name,
						args: /** @type {Record<string, JsonValue>} */ (call.arguments),
					});
					modelActions += controller.turn.turn - before;
					if (name === "play" && executed.envelope.ok && call.arguments.action === "ACTION6") {
						const recorded = (await artifacts.readDomain()).find(
							(record) => record.recordType === "action.intent" && record.payload.actionId === invocationId,
						);
						const action = /** @type {GameAction | undefined} */ (recorded?.payload.action);
						const { x, y } = call.arguments;
						if (
							typeof x === "number" &&
							typeof y === "number" &&
							typeof action?.data.x === "number" &&
							typeof action.data.y === "number"
						) {
							coordinateChecks.push({
								modelX: x,
								modelY: y,
								nativeX: action.data.x,
								nativeY: action.data.y,
								mappingMatches: Math.floor(x / 16) === action.data.x && Math.floor(y / 16) === action.data.y,
							});
						}
					}
				}
				const result =
					executed.envelope.error?.code === "storage_failure"
						? { ...executed.envelope, error: { code: "storage_failure", message: "Tool storage failed" } }
						: executed.envelope;
				await artifacts.appendRuntime(result.ok ? "tool.completed" : "tool.rejected", now(), {
					name,
					invocationId,
					turnId: `request-${round + 1}`,
					ok: result.ok,
					...(result.error ? { code: result.error.code } : {}),
				});
				messages.push({
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					content: [
						{ type: "text", text: JSON.stringify(result) },
						...executed.images.map((visual) => ({
							type: /** @type {const} */ ("image"),
							mimeType: "image/png",
							data: Buffer.from(encodeVisualPng(visual)).toString("base64"),
						})),
					],
					isError: !result.ok,
					timestamp: Date.now(),
				});
			}
		}
		if (!controller.termination) await controller.finish("model_no_progress");
		if (controller.termination?.terminationReason === "WIN") diagnosticReason = "authoritative_win";
		if (controller.termination?.terminationReason === "action_budget_exhausted")
			diagnosticReason = "post_reset_action_budget_exhausted";
	} catch {
		if (controller && !controller.termination)
			await controller.finish(
				global.signal.aborted ? "cancelled" : requests ? "model_failure" : "controller_failure",
			);
		diagnosticReason = global.signal.aborted
			? "global_timeout"
			: requests
				? "model_request_or_tool_failed"
				: "setup_failed";
	} finally {
		clearTimeout(timer);
		global.abort();
		try {
			await environment?.close();
		} finally {
			await rm(receipts, { recursive: true, force: true });
		}
	}
	const audit = controller ? await artifacts.audit() : null;
	const report = {
		validationMode: fixture ? "diagnostic-fixture" : "diagnostic",
		benchmark: false,
		sourceDigest: source.digest,
		game: source.game,
		setup: {
			origin: "driver-replay",
			actions: source.actions.length,
			replayedActions,
			replayValidated: reachedGameOver,
			resetActions: resetCompleted ? 1 : 0,
			verifiedCompletedActions: true,
			reachedGameOver,
		},
		model: {
			provider,
			modelId,
			requests,
			actions: modelActions,
			toolCalls,
			requestImageCounts,
			coordinateChecks,
			usage: requestUsage,
		},
		limits,
		diagnosticReason,
		terminationReason: controller?.termination?.terminationReason ?? null,
		lastCommittedTurn: controller?.turn.turn ?? null,
		audit,
	};
	await writeFile(path.join(root, "diagnostic-report.json"), `${JSON.stringify(report, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	return report;
}
