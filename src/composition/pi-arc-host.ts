/**
 * 单局 SDK host：只在此处组装 Game、sidecar、controller、Pi 与 archive。
 *
 * 公开调用只返回结构化拒绝或终止结果；Environment 效果始终经过
 * RunController，模型 settlement 和 CLI event 不能替代 Turn commit。
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonlSessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import type { Models } from "@earendil-works/pi-ai";
import { ArtifactStore, type AuditReport, type TerminalRecord } from "../adapters/artifact-store.js";
import {
	FULL_GAME_ID,
	GAME_SEED,
	type GameCatalogPort,
	GameResolver,
	type ResolvedGame,
} from "../adapters/game-resolver.js";
import { canonicalJsonDigest } from "../adapters/sha256.js";
import { SidecarClient, type SidecarProcessOptions } from "../adapters/sidecar-client.js";
import { VisualPngPublisher } from "../adapters/visual-png.js";
import { buildInitialTaskPrompt } from "../application/model-prompts.js";
import { ModelToolExecutor } from "../application/model-tools.js";
import {
	type ArtifactManifest,
	type ControllerPorts,
	RunController,
	type TerminationReason,
} from "../application/run-controller.js";
import type { JsonValue } from "../protocol/canonical-json.js";
import { ArtifactEvidenceReader } from "./artifact-evidence.js";
import { controllerPlayPort, recoverController } from "./controller-play.js";
import { KnowledgeStore } from "./knowledge-store.js";
import { OfficialGameCatalog } from "./official-catalog.js";
import { PiArcRuntime, type RuntimeStep, resolveRuntimeModel } from "./pi-runtime.js";
import { loadModelSystemPrompt } from "./prompt-loader.js";
import { type RunEvent, RunEventJournal } from "./run-events.js";
import { RuntimeKnowledgeBridge } from "./runtime-knowledge.js";

export type AuditResult = AuditReport;

export interface RunRequest {
	gameId: string;
	gameCache: string;
	provider: string;
	modelId: string;
	artifactRoot: string;
	gameOffline?: boolean;
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	actionBudget?: number;
	signal?: AbortSignal;
}

export interface ResumeRequest {
	artifactRoot: string;
	signal?: AbortSignal;
}

export interface RunResult {
	runId: string;
	game: { id: string; sourceLocator: string; treeDigest: string };
	outcomeClass: "win" | "non_success" | "unknown_outcome" | "audit_failure";
	terminationReason: string;
	lastCommittedTurn: number;
	artifactRoot: string;
	manifest: string;
	audit: AuditResult;
}

export type RunInvocationResult = { status: "rejected"; reason: string } | { status: "terminated"; result: RunResult };

export interface PiArcHost {
	run(request: RunRequest): Promise<RunInvocationResult>;
	resume(request: ResumeRequest): Promise<RunInvocationResult>;
	audit(artifactRoot: string): Promise<AuditResult>;
	readEvents(artifactRoot: string, afterSequence?: number): AsyncIterable<RunEvent>;
}

export interface HostPorts {
	catalog?: GameCatalogPort;
	sidecar?: (options: SidecarProcessOptions) => SidecarClient;
	now?: () => string;
	newId?: () => string;
	python?: string;
}

const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function rejection(reason: string): RunInvocationResult {
	return { status: "rejected", reason };
}

function isMissing(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function ownKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
	const allowed = new Set([...required, ...optional]);
	return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function validRunRequest(request: RunRequest): boolean {
	const value = request as unknown as Record<string, unknown>;
	return (
		ownKeys(
			value,
			["gameId", "gameCache", "provider", "modelId", "artifactRoot"],
			["gameOffline", "thinkingLevel", "actionBudget", "signal"],
		) &&
		typeof request.gameId === "string" &&
		FULL_GAME_ID.test(request.gameId) &&
		[request.gameCache, request.provider, request.modelId, request.artifactRoot].every(
			(item) => typeof item === "string" && item.length > 0,
		) &&
		(request.gameOffline === undefined || typeof request.gameOffline === "boolean") &&
		(request.thinkingLevel === undefined || THINKING.has(request.thinkingLevel)) &&
		(request.actionBudget === undefined ||
			(Number.isSafeInteger(request.actionBudget) && request.actionBudget >= 1 && request.actionBudget <= 999_999))
	);
}

async function emptyArtifactRoot(root: string): Promise<boolean> {
	try {
		const info = await lstat(root);
		return info.isDirectory() && !info.isSymbolicLink() && (await readdir(root)).length === 0;
	} catch (error) {
		if (isMissing(error)) return true;
		return false;
	}
}

function gameIdentity(manifest: Record<string, JsonValue>): RunResult["game"] {
	const value = manifest.game;
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Game manifest is invalid");
	const game = value as Record<string, JsonValue>;
	if (typeof game.id !== "string" || typeof game.sourceLocator !== "string" || typeof game.treeDigest !== "string")
		throw new Error("Game identity is invalid");
	return { id: game.id, sourceLocator: game.sourceLocator, treeDigest: game.treeDigest };
}

function runResult(
	root: string,
	manifest: Record<string, JsonValue>,
	terminal: TerminalRecord,
	audit: AuditResult,
): RunResult {
	return {
		runId: terminal.runId,
		game: gameIdentity(manifest),
		outcomeClass: audit.ok ? terminal.outcomeClass : "audit_failure",
		terminationReason: terminal.terminationReason,
		lastCommittedTurn: terminal.lastCommittedTurn,
		artifactRoot: root,
		manifest: path.join(root, "manifest.json"),
		audit,
	};
}

function manifestFor(runId: string, game: ResolvedGame, request: RunRequest): ArtifactManifest {
	return {
		schema: "pi-arc.run-manifest.v1",
		runId,
		game: { id: game.gameId, sourceLocator: game.sourceLocator, treeDigest: game.treeDigest },
		model: {
			provider: request.provider,
			modelId: request.modelId,
			...(request.thinkingLevel === undefined ? {} : { thinkingLevel: request.thinkingLevel }),
		},
		runtime: { piAgentCore: "0.86.0", piAi: "0.86.0" },
		coordinates: 1024,
		seed: GAME_SEED,
		config: { actionBudget: request.actionBudget ?? 2000, gameOffline: request.gameOffline ?? false },
	};
}

/** 测试可注入 faux Models/catalog/clock；根 SDK 工厂只接受 Models。 */
export function createHostWithPorts(models: Models, options: HostPorts = {}): PiArcHost {
	const now = options.now ?? (() => new Date().toISOString());
	const newId = options.newId ?? randomUUID;
	const python = options.python ?? fileURLToPath(new URL("../../.venv/bin/python", import.meta.url));
	const pythonPath = fileURLToPath(new URL("../../python", import.meta.url));
	const resolver = new GameResolver(options.catalog ?? new OfficialGameCatalog(python, pythonPath));

	function audit(root: string): Promise<AuditResult> {
		return new ArtifactStore(root).audit();
	}

	async function* readEvents(root: string, afterSequence = 0): AsyncIterable<RunEvent> {
		const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as { runId: string };
		const journal = new RunEventJournal(root, manifest.runId, now);
		for (const event of await journal.read(afterSequence)) yield event;
	}

	async function resume(request: ResumeRequest): Promise<RunInvocationResult> {
		if (
			!ownKeys(request as unknown as Record<string, unknown>, ["artifactRoot"], ["signal"]) ||
			typeof request.artifactRoot !== "string" ||
			request.artifactRoot.length === 0
		)
			return rejection("invalid_request");
		const root = path.resolve(request.artifactRoot);
		const artifacts = new ArtifactStore(root);
		let manifest: Record<string, JsonValue>;
		try {
			manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as Record<string, JsonValue>;
			if (manifest.schema !== "pi-arc.run-manifest.v1" || typeof manifest.runId !== "string")
				return rejection("archive_invalid");
		} catch {
			return rejection("archive_invalid");
		}
		const runId = manifest.runId as string;
		const journal = new RunEventJournal(root, runId, now);
		let terminal: TerminalRecord | undefined;
		try {
			terminal = await artifacts.readTerminal();
		} catch {
			return rejection("archive_invalid");
		}
		const resumedActive = terminal === undefined;
		if (terminal === undefined) {
			// CLI resume 是新进程；WP-05 sidecar 不继承旧 instance。仅让 controller
			// 从 ledger 判定 environment_lost/unknown_action_outcome，不启动新实例。
			const unavailable = {
				open: () => Promise.reject(new Error("prior Environment instance is gone")),
				request: () => Promise.reject(new Error("prior Environment instance is gone")),
			};
			const ports: ControllerPorts = {
				artifacts,
				environment: unavailable,
				visuals: new VisualPngPublisher(root),
				now,
				digest: canonicalJsonDigest,
			};
			try {
				const recovered = await RunController.recover(runId, ports);
				if (recovered.termination === null) await recovered.finish("environment_lost");
			} catch {
				// pending Action 的 Unknown Outcome 由 controller 在异常前持久化。
			}
			terminal = await artifacts.readTerminal();
			if (terminal === undefined) return rejection("archive_invalid");
			await journal.append("run.resumed", { artifactRoot: root }, "run.resumed");
			await journal.reconcile(artifacts);
		}
		const report = await artifacts.audit();
		const result = runResult(root, manifest, terminal, report);
		// 已有 terminal 的 resume 只能审计；即使事件投影缺尾也不改写 archive。
		if (resumedActive && (await journal.read()).at(-1)?.type !== "run.completed")
			await journal.append(
				"run.completed",
				{
					game: result.game,
					outcomeClass: result.outcomeClass,
					terminationReason: result.terminationReason,
					artifactRoot: root,
				},
				"run.completed",
			);
		return { status: "terminated", result };
	}

	async function run(request: RunRequest): Promise<RunInvocationResult> {
		if (!validRunRequest(request)) return rejection("invalid_request");
		if (request.signal?.aborted) return rejection("cancelled_before_start");
		const root = path.resolve(request.artifactRoot);
		if (!(await emptyArtifactRoot(root))) return rejection("artifact_unavailable");
		let game: ResolvedGame;
		try {
			game = await resolver.resolve({
				gameId: request.gameId,
				cacheRoot: request.gameCache,
				offline: request.gameOffline ?? false,
			});
		} catch (error) {
			return rejection(error instanceof Error && "code" in error ? String(error.code) : "game_unavailable");
		}
		const model = await resolveRuntimeModel(models, request.provider, request.modelId);
		if (model === null) return rejection("model_unavailable");
		if (request.thinkingLevel !== undefined && request.thinkingLevel !== "off" && !model.reasoning)
			return rejection("thinking_unsupported");
		if (!(await emptyArtifactRoot(root))) return rejection("artifact_unavailable");

		const runId = newId();
		const manifest = manifestFor(runId, game, request);
		const artifacts = new ArtifactStore(root);
		const journal = new RunEventJournal(root, runId, now);
		const sessionRepo = new JsonlSessionRepo({
			fileSystem: new NodeExecutionEnv({ cwd: root }),
			sessionsRoot: path.join(root, "pi-session"),
		});
		const receiptRoot = await mkdtemp(path.join(os.tmpdir(), "pi-arc-receipts-"));
		let sidecar: SidecarClient;
		try {
			sidecar = (options.sidecar ?? ((sidecarOptions) => new SidecarClient(sidecarOptions)))({
				environmentRoot: game.environmentRoot,
				cacheRoot: receiptRoot,
				gameId: game.gameId,
				sourceLocator: game.sourceLocator,
				treeDigest: game.treeDigest,
				seed: GAME_SEED,
				python,
				pythonPath,
			});
		} catch {
			await sessionRepo.close(TODO_CONTEXT).catch(() => undefined);
			await rm(receiptRoot, { recursive: true, force: true });
			return rejection("startup_failed");
		}
		let active: RunController | null = null;
		let runtime: PiArcRuntime | null = null;
		let started = false;
		const ports: ControllerPorts = {
			artifacts: {
				writeManifest: (value) => artifacts.writeManifest(value),
				appendDomain: async (type, at, payload) => {
					const record = await artifacts.appendDomain(type, at, payload);
					if (started) await journal.domain(record);
					return record;
				},
				writeRawFrame: (frame) => artifacts.writeRawFrame(frame),
				writeVisualReference: (reference) => artifacts.writeVisualReference(reference),
				writeTerminal: (value) => artifacts.writeTerminal(value),
				appendLateEvidence: (at, payload) => artifacts.appendLateEvidence(at, payload),
				readDomain: () => artifacts.readDomain(),
				readTerminal: () => artifacts.readTerminal(),
			},
			environment: sidecar,
			visuals: new VisualPngPublisher(root),
			now,
			digest: canonicalJsonDigest,
		};
		try {
			const session = await sessionRepo.create({ cwd: root, id: runId }, TODO_CONTEXT);
			active = await RunController.start({ manifest, sessionId: session.metadata.id, laneId: "arc" }, ports);
			started = true;
			await journal.append("run.started", { game: gameIdentity(manifest), artifactRoot: root }, "run.started");
			await journal.reconcile(artifacts);
			if (active.termination === null) {
				const evidence = new ArtifactEvidenceReader(root, artifacts);
				const anchor = () =>
					canonicalJsonDigest({
						runId,
						environmentInstanceId: active?.environmentInstanceId ?? "",
						turn: active?.turn.turn ?? 0,
						observationDigest: active?.turn.observationDigest ?? "",
						level: active?.turn.level ?? 0,
						attempt: active?.turn.attempt ?? 0,
					});
				const knowledge = new KnowledgeStore(root, artifacts, anchor, now);
				const bridge = new RuntimeKnowledgeBridge(artifacts, knowledge);
				const prompt = await loadModelSystemPrompt();
				runtime = await PiArcRuntime.attach({
					session,
					models,
					provider: request.provider,
					modelId: request.modelId,
					laneId: "arc",
					systemPrompt: prompt.systemPrompt,
					...(request.thinkingLevel === undefined ? {} : { thinkingLevel: request.thinkingLevel }),
					evidence: {
						readRuntime: () => artifacts.readRuntime(),
						appendRuntime: async (type, at, payload) => {
							const record = await artifacts.appendRuntime(type, at, payload);
							await journal.runtime(record);
							return record;
						},
					},
					now,
					recoverAuthority: async () => {
						active = await recoverController(runId, ports)();
						return active;
					},
					validateKnowledge: (authority) => bridge.validate(authority),
					createExecutor: (authority) =>
						new ModelToolExecutor({
							play: controllerPlayPort(authority as RunController, evidence),
							evidence,
							knowledge,
							digest: canonicalJsonDigest,
							anchor,
							isTerminated: () => authority.termination !== null,
						}),
					buildRecoveryEnvelope: (authority) => bridge.recoveryEnvelope(authority),
					pendingCheckpoint: () => bridge.pendingCheckpoint(),
					boundary: {
						prepare: (authority) => bridge.prepareBoundary(authority),
						acknowledge: (boundaryId) => bridge.acknowledgeBoundary(boundaryId),
					},
				});
				let step: RuntimeStep | null = null;
				for (const openStep of await runtime.driveOpen()) step = openStep;
				let first = true;
				let waits = 0;
				while (active.termination === null) {
					if (request.signal?.aborted) {
						await active.cancel();
						break;
					}
					if (active.turn.turn >= (request.actionBudget ?? 2000)) {
						await active.finish("action_budget_exhausted");
						break;
					}
					if (step?.kind === "waiting") {
						if (++waits > 128) {
							await active.finish("model_failure");
							break;
						}
						step = await runtime.resumeWaiting();
						continue;
					}
					waits = 0;
					step = await runtime.prompt(
						first ? buildInitialTaskPrompt(active.turn.observation) : await bridge.recoveryEnvelope(active),
					);
					first = false;
				}
			}
		} catch {
			if (active?.termination === null) {
				try {
					await active.finish("controller_failure" satisfies TerminationReason);
				} catch {
					// 无法证明 terminal 时，不伪造成功结果。
				}
			}
		} finally {
			await runtime?.close().catch(() => undefined);
			await sessionRepo.close(TODO_CONTEXT).catch(() => undefined);
			try {
				await sidecar.close();
			} finally {
				await rm(receiptRoot, { recursive: true, force: true });
			}
		}
		if (!started) return rejection("startup_failed");
		const terminal = await artifacts.readTerminal();
		if (terminal === undefined) return rejection("controller_failure");
		await journal.reconcile(artifacts);
		const report = await artifacts.rebuildAudit();
		const result = runResult(root, manifest, terminal, report);
		await journal.append(
			"run.completed",
			{
				game: result.game,
				outcomeClass: result.outcomeClass,
				terminationReason: result.terminationReason,
				artifactRoot: root,
			},
			"run.completed",
		);
		return { status: "terminated", result };
	}

	return { run, resume, audit, readEvents };
}
