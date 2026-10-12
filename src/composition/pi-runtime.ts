/**
 * 稳定 AgentHarness v4 的最小 ARC runtime 边界。
 *
 * attach 先完成 ARC controller 的同实例 reconciliation 与知识检查，再取得
 * open operation inventory；任何 drive/prompt 都只能在这些检查之后发生。
 * Pi session 只记录模型进度，不能作为 Environment anchor 的替代品。
 */

import {
	AgentHarness,
	type AgentLane,
	type Context,
	type AgentHarness as Harness,
	type OpenOperation,
	type OperationResultRecord,
	type Session,
	TODO_CONTEXT,
} from "@earendil-works/pi-agent-core";
import type { Api, ImageContent, Model, Models } from "@earendil-works/pi-ai";
import { CHECKPOINT_PROMPT, NONTERMINAL_CONTINUATION_PROMPT } from "../application/model-prompts.js";
import type { ModelToolExecutor } from "../application/model-tools.js";
import type { TerminalRecord, TerminationReason, Turn } from "../application/run-controller.js";
import { countContextImages, projectedToolImages } from "./image-capacity.js";
import { installModelRequestMetrics } from "./model-request-metrics.js";
import { PiToolAdapter, type PiToolEvidence } from "./pi-tools.js";
import { installRequestPrefixMetrics, type RequestPrefixMetrics } from "./request-prefix-metrics.js";
import { DEEPSEEK_CONTEXT_IMAGE_LIMIT } from "./visual-context.js";

export interface RuntimeAuthority {
	readonly turn: Turn;
	readonly termination: TerminalRecord | null;
	finish(reason: TerminationReason): Promise<TerminalRecord>;
}

export interface PiRuntimeOptions {
	session: Session;
	models: Models;
	provider: string;
	modelId: string;
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	laneId: string;
	systemPrompt: string;
	evidence: PiToolEvidence;
	now(): string;
	/** 必须执行 RunController.recover 或等价的同实例校验，不能只返回缓存对象。 */
	recoverAuthority(): Promise<RuntimeAuthority>;
	/** 检查 GUIDE/WORKING/checkpoint anchor，并拒绝不完整的知识边界。 */
	validateKnowledge(authority: RuntimeAuthority): Promise<void>;
	createExecutor(authority: RuntimeAuthority): ModelToolExecutor;
	buildRecoveryEnvelope(authority: RuntimeAuthority): Promise<string>;
	pendingCheckpoint(): Promise<boolean>;
	requestCheckpoint?(): Promise<void>;
	recoveryImages?(authority: RuntimeAuthority): Promise<ImageContent[]>;
	boundary: {
		/** 从已提交 RESET/checkpoint 准备同一个可重放的模型恢复消息。 */
		prepare(authority: RuntimeAuthority): Promise<{ boundaryId: string; prompt: string } | null>;
		/** Pi prompt operation 已持久接纳后，才解除 Action boundary gate。 */
		acknowledge(boundaryId: string): Promise<void>;
	};
	context?: Context;
	/** Cancels model operations only; authority evidence/cleanup stay uncancelled. */
	signal?: AbortSignal;
}

/** VISTA reserves 32k for the checkpoint and another 40k for the ordinary turn. */
export function contextThresholds(contextWindow: number): { normal: number; checkpoint: number } {
	const checkpoint = contextWindow - 32_000;
	const normal = checkpoint - 40_000;
	if (!Number.isSafeInteger(contextWindow) || normal < 16_000)
		throw new Error("model context window is too small for ARC checkpointing");
	return { normal, checkpoint };
}

/** Sixteen attempts permit useful inspection without unbounded read/rejection loops. */
export const ORDINARY_TOOL_ATTEMPT_LIMIT = 16;

/** Inventory only: never proof of an Environment Action. */
export class OrdinaryProgressGuard {
	stage: 0 | 1 | 2 = 0;
	private count = 0;
	private anchor = "";
	private allowed = new Set<string>();
	private stopId: string | null = null;
	constructor(
		private readonly options: Pick<PiRuntimeOptions, "evidence" | "now">,
		private readonly authority: RuntimeAuthority,
	) {}
	private key(): string {
		const turn = this.authority.turn;
		return `${turn.turn}:${turn.observationDigest}:${turn.attempt}`;
	}
	private sync(): void {
		if (this.anchor === this.key()) return;
		this.anchor = this.key();
		this.stage = 0;
		this.count = 0;
		this.allowed.clear();
		this.stopId = null;
	}
	async restore(): Promise<void> {
		this.sync();
		for (const record of await this.options.evidence.readRuntime()) {
			if (
				record.eventType !== "context.boundary" ||
				record.payload.phase !== "ordinary.progress" ||
				record.payload.anchor !== this.anchor
			)
				continue;
			const { stage, count, allowed, stopId } = record.payload;
			if ((stage === 0 || stage === 1 || stage === 2) && typeof count === "number") {
				this.stage = stage;
				this.count = count;
				this.allowed = new Set(
					Array.isArray(allowed) ? allowed.filter((id): id is string => typeof id === "string") : [],
				);
				this.stopId = typeof stopId === "string" ? stopId : null;
			}
		}
	}
	private async record(): Promise<void> {
		await this.options.evidence.appendRuntime("context.boundary", this.options.now(), {
			reason: "model_no_progress",
			phase: "ordinary.progress",
			anchor: this.anchor,
			turn: this.authority.turn.turn,
			observationDigest: this.authority.turn.observationDigest,
			attempt: this.authority.turn.attempt,
			stage: this.stage,
			count: this.count,
			allowed: [...this.allowed],
			stopId: this.stopId,
		});
	}
	async begin(stage: 0 | 1 | 2): Promise<void> {
		this.sync();
		if (this.stage !== stage) {
			this.stage = stage;
			this.count = 0;
			this.allowed.clear();
			this.stopId = null;
		}
		await this.record();
	}
	async response(ids: string[]): Promise<void> {
		this.sync();
		// Tool-call ids are scoped to a response, not guaranteed unique across requests.
		this.allowed.clear();
		this.stopId = null;
		for (const id of ids) {
			this.count += 1;
			if (this.count <= ORDINARY_TOOL_ATTEMPT_LIMIT) this.allowed.add(id);
			if (this.count === ORDINARY_TOOL_ATTEMPT_LIMIT) this.stopId = id;
		}
		await this.record();
	}
	exhausted(): boolean {
		this.sync();
		return this.count >= ORDINARY_TOOL_ATTEMPT_LIMIT;
	}
	admits(id: string): boolean {
		this.sync();
		return this.count <= ORDINARY_TOOL_ATTEMPT_LIMIT || this.allowed.has(id);
	}
	stops(id: string): boolean {
		this.sync();
		return id === this.stopId;
	}
}

interface RecoveryPrompt {
	prompt: string;
	boundaryId: string | null;
}

export type RuntimeStep =
	| { kind: "settled"; result: OperationResultRecord; terminal: TerminalRecord | null }
	| { kind: "waiting"; operationId: string; reason: "retry" | "deferred" }
	| { kind: "terminal"; terminal: TerminalRecord };

/** 公开 Models 边界只返回已配置模型；凭据值从不进入 Run artifact。 */
export async function resolveRuntimeModel(
	models: Models,
	provider: string,
	modelId: string,
): Promise<Model<Api> | null> {
	const model = models.getModel(provider, modelId);
	if (model === undefined) return null;
	try {
		const auth = await models.getAuth(model);
		return auth === undefined ? null : model;
	} catch {
		return null;
	}
}

/** runtime record 仅保存公开 identity/status/error code，禁止正文、参数、auth。 */
export class PiArcRuntime {
	readonly open: readonly OpenOperation[];
	readonly authority: RuntimeAuthority;
	private readonly harness: Harness<undefined>;
	private readonly prefixMetrics: RequestPrefixMetrics;
	private readonly ordinary: OrdinaryProgressGuard;
	private readonly lane: AgentLane;
	private readonly options: PiRuntimeOptions;
	private readonly context: Context;
	private pendingRecovery: RecoveryPrompt | null;
	private openResolved: boolean;
	private nextOpen = 0;
	private waitingOperationId: string | null = null;
	private progress: { beforeTurn: number; stage: 0 | 1 | 2 } | null = null;
	private cancellation: Promise<unknown> = Promise.resolve();
	private checkpointAttempts = 0;
	private checkpointCycles = 0;
	private checkpointDriving = false;
	private checkpointTurn: number;
	private readonly policy: { input: number; needed: boolean; checkpointLimit: number; imageLimit: number };
	private readonly onAbort = () => {
		// Pi must durably close its effect gate before signalling provider work.
		// Cancelling just the caller Context abandons the drive waiter and can
		// interrupt mandatory settlement rather than cancelling the operation.
		this.cancellation = this.lane.abort(this.context);
		void this.cancellation.catch(() => undefined);
	};

	private constructor(
		options: PiRuntimeOptions,
		harness: Harness<undefined>,
		lane: AgentLane,
		open: OpenOperation[],
		authority: RuntimeAuthority,
		pendingRecovery: RecoveryPrompt | null,
		policy: { input: number; needed: boolean; checkpointLimit: number; imageLimit: number },
		prefixMetrics: RequestPrefixMetrics,
		ordinary: OrdinaryProgressGuard,
	) {
		this.ordinary = ordinary;
		this.prefixMetrics = prefixMetrics;
		this.policy = policy;
		this.checkpointTurn = authority.turn.turn;
		this.options = options;
		this.harness = harness;
		this.lane = lane;
		this.open = open;
		this.authority = authority;
		this.pendingRecovery = pendingRecovery;
		this.context = options.context ?? TODO_CONTEXT;
		this.openResolved = open.length === 0;
		options.signal?.addEventListener("abort", this.onAbort, { once: true });
	}

	static async attach(options: PiRuntimeOptions): Promise<PiArcRuntime> {
		const context = options.context ?? TODO_CONTEXT;
		const authority = await options.recoverAuthority();
		await options.validateKnowledge(authority);
		const model = await resolveRuntimeModel(options.models, options.provider, options.modelId);
		if (model === null) {
			if (authority.termination === null) await authority.finish("model_failure");
			throw new Error("model is unavailable or unconfigured");
		}
		const thresholds = contextThresholds(model.contextWindow);
		const ordinary = new OrdinaryProgressGuard(options, authority);
		await ordinary.restore();
		const ordinaryEnabled = async () =>
			!(await options.pendingCheckpoint()) && (await options.boundary.prepare(authority)) === null;
		const policy = {
			input: 0,
			needed: false,
			checkpointLimit: thresholds.checkpoint,
			// 64 是此后端兼容上限，不推断其他 provider 的容量。
			imageLimit:
				model.provider === "opencode-go" && model.id.startsWith("deepseek-")
					? DEEPSEEK_CONTEXT_IMAGE_LIMIT
					: Number.POSITIVE_INFINITY,
		};
		const adapter = await PiToolAdapter.create({
			executor: options.createExecutor(authority),
			evidence: options.evidence,
			now: options.now,
			isTerminated: () => authority.termination !== null,
		});
		const created = await AgentHarness.create<undefined>(
			{
				session: options.session,
				models: options.models,
				model,
				...(options.thinkingLevel === undefined ? {} : { thinkingLevel: options.thinkingLevel }),
				tools: adapter.tools(),
				systemPrompt: options.systemPrompt,
				toolExecution: "sequential",
				// ARC checkpoint is the only compaction protocol, including overflow.
				compaction: { enabled: false, reserveTokens: 32_000, keepRecentTokens: 0 },
			},
			context,
		);
		// 图片容量只通过 ARC boundary 释放；段内已发送消息永不改写。
		const lane = await created.harness.lane(options.laneId, context);
		const imageCount = async () => {
			const entries = await lane.findEntries({ type: "message", order: "oldestFirst" }, context);
			return countContextImages(entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : [])));
		};
		// 重启可能先结算 effect_pending；不可在 drive 前丢弃已接纳 receipt。
		// 最后的 generation gate 拒绝超容恢复上下文，不修改任何消息或 payload。
		created.harness.hooks.on("before_request", async ({ runId }) => {
			// No pending receipt remains at this generation gate. Schema-invalid tools
			// bypass tool hooks, so exhaustion must also be enforced here.
			try {
				if ((await ordinaryEnabled()) && ordinary.exhausted()) {
					await lane.requestAbort(runId, context);
					return undefined;
				}
			} catch {
				await lane.requestAbort(runId, context);
				if (authority.termination === null) await authority.finish("controller_failure");
				return undefined;
			}
			if (!Number.isFinite(policy.imageLimit)) return undefined;
			let safe = false;
			try {
				safe = (await imageCount()) <= policy.imageLimit;
			} catch {
				// 容量无法证明时同样拒绝；hook throw 会被 Pi 捕获，不能靠 throw 门禁。
			}
			if (!safe) {
				// 先持久关闭 effect gate；即使 terminal 写入失败也不能发出超容请求。
				await lane.requestAbort(runId, context);
				if (authority.termination === null) await authority.finish("checkpoint_failed");
			}
			return undefined;
		});
		created.harness.hooks.on("before_compaction", () => ({ decline: true }));
		created.harness.hooks.on("after_response", async ({ message, runId }) => {
			policy.input = message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
			if (policy.input >= thresholds.normal) policy.needed = true;
			try {
				// Capacity/knowledge gates are checkpoint work, not ordinary attempts.
				if (!policy.needed && (await ordinaryEnabled()))
					await ordinary.response(message.content.flatMap((part) => (part.type === "toolCall" ? [part.id] : [])));
			} catch {
				await lane.requestAbort(runId, context);
				if (authority.termination === null) await authority.finish("controller_failure");
			}
			return undefined;
		});
		created.harness.hooks.on("before_tool", async ({ toolName, args, toolCallId }) => {
			if (authority.termination !== null) return { block: { reason: "terminal", terminate: true } };
			try {
				const images = await imageCount();
				if (images > policy.imageLimit) throw new Error("restored image capacity exceeded");
				if (images + projectedToolImages(toolName, args) > policy.imageLimit) {
					policy.needed = true;
					await options.evidence.appendRuntime("context.boundary", options.now(), {
						reason: "image_capacity",
						turn: authority.turn.turn,
					});
				}
				if (
					policy.needed &&
					!(await options.pendingCheckpoint()) &&
					(await options.boundary.prepare(authority)) === null
				) {
					if (options.requestCheckpoint === undefined)
						throw new Error("checkpoint policy requires an anchor gate");
					await options.requestCheckpoint();
				}
			} catch {
				await authority.finish("checkpoint_failed");
				return { block: { reason: "checkpoint_failed", terminate: true } };
			}
			if ((await options.pendingCheckpoint()) && policy.input >= policy.checkpointLimit)
				return { block: { reason: "checkpoint_capacity_exhausted", terminate: true } };
			if ((await options.pendingCheckpoint()) && toolName !== "save_compact_checkpoint")
				return { block: { reason: "checkpoint_required", terminate: true } };
			if ((await options.boundary.prepare(authority)) !== null)
				return { block: { reason: "context_boundary_required", terminate: true } };
			if (toolName !== "save_compact_checkpoint" && !ordinary.admits(toolCallId))
				return { block: { reason: "model_no_progress", terminate: true } };
			return undefined;
		});
		created.harness.hooks.on("after_tool", async ({ toolName, content, toolCallId }) => {
			// A recovered effect_pending tool can settle without before_tool.
			// Never abandon its receipt: close the loop only after its result settles.
			// 此时当前结果尚未写入 branch；必须连同它计算，尤其是恢复的 effect_pending。
			const images = (await imageCount()) + content.filter((part) => part.type === "image").length;
			if (images > policy.imageLimit) {
				if (authority.termination === null) await authority.finish("checkpoint_failed");
				return { terminate: true };
			}
			if (images === policy.imageLimit) {
				policy.needed = true;
				await options.evidence.appendRuntime("context.boundary", options.now(), {
					reason: "image_capacity",
					turn: authority.turn.turn,
				});
			}
			if (authority.termination !== null || toolName === "save_compact_checkpoint") return { terminate: true };
			if ((await options.boundary.prepare(authority)) !== null) return { terminate: true };
			if (policy.needed) {
				try {
					if (!(await options.pendingCheckpoint())) {
						if (options.requestCheckpoint === undefined) throw new Error("checkpoint anchor gate unavailable");
						await options.requestCheckpoint();
					}
				} catch {
					await authority.finish("checkpoint_failed");
				}
				return { terminate: true };
			}
			if (ordinary.stops(toolCallId)) return { terminate: true };
			return undefined;
		});
		const correlation = installModelRequestMetrics(created.harness, options.evidence, options.now);
		const prefixMetrics = installRequestPrefixMetrics(created.harness, options.evidence, options.now, correlation);
		// open 是 inventory，不可把它解释成已完成的游戏 Action。
		const open = created.open.filter((item) => item.lane === options.laneId);
		let pendingRecovery: RecoveryPrompt | null = null;
		if (authority.termination === null) {
			const boundary = await options.boundary.prepare(authority);
			if (boundary !== null) pendingRecovery = { prompt: boundary.prompt, boundaryId: boundary.boundaryId };
			else if (await options.pendingCheckpoint())
				pendingRecovery = { prompt: await options.buildRecoveryEnvelope(authority), boundaryId: null };
		}
		if (pendingRecovery === null && authority.termination === null && authority.turn.actionId !== null) {
			const entries = await lane.findEntries({ type: "message", order: "oldestFirst" }, context);
			const settled = entries.some((entry) => {
				if (entry.type !== "message" || entry.message.role !== "toolResult" || entry.message.toolName !== "play")
					return false;
				const details: unknown = entry.message.details;
				return (
					typeof details === "object" &&
					details !== null &&
					"invocationId" in details &&
					details.invocationId === authority.turn.actionId
				);
			});
			if (!settled) pendingRecovery = { prompt: await options.buildRecoveryEnvelope(authority), boundaryId: null };
		}
		// A crash between durable progression-stage admission and Pi prompt admission
		// must not substitute the caller's ordinary prompt for the recovery policy.
		if (pendingRecovery === null && authority.termination === null && open.length === 0 && ordinary.stage > 0) {
			pendingRecovery = {
				prompt:
					ordinary.stage === 1 ? NONTERMINAL_CONTINUATION_PROMPT : await options.buildRecoveryEnvelope(authority),
				boundaryId: null,
			};
		}
		// Usage survives interruption; do not restart the capacity allowance at attach.
		const entries = await lane.findEntries({ type: "message", order: "oldestFirst" }, context);
		for (const entry of entries) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				const usage = entry.message.usage;
				policy.input = usage.input + usage.cacheRead + usage.cacheWrite;
			}
		}
		policy.needed = policy.input >= thresholds.normal;
		const runtime = new PiArcRuntime(
			options,
			created.harness,
			lane,
			open,
			authority,
			pendingRecovery,
			policy,
			prefixMetrics,
			ordinary,
		);
		const records = await options.evidence.readRuntime();
		const sameAnchor = records.filter(
			(record) =>
				record.eventType === "context.boundary" &&
				record.payload.turn === authority.turn.turn &&
				record.payload.observationDigest === authority.turn.observationDigest,
		);
		runtime.checkpointAttempts = sameAnchor.filter((record) => record.payload.phase === "checkpoint.attempt").length;
		runtime.checkpointCycles = sameAnchor.filter((record) => record.payload.phase === "checkpoint.fresh").length;
		return runtime;
	}

	/** 只处理 attach 时已盘点的 open operation；调用者不得绕开此入口。 */
	async driveOpen(): Promise<RuntimeStep[]> {
		if (this.authority.termination !== null) return [{ kind: "terminal", terminal: this.authority.termination }];
		if (this.waitingOperationId !== null) throw new Error("use resumeWaiting for an already driven operation");
		const steps: RuntimeStep[] = [];
		for (; this.nextOpen < this.open.length; this.nextOpen += 1) {
			const operation = this.open[this.nextOpen];
			if (operation === undefined) throw new Error("open operation inventory changed");
			if (this.authority.termination !== null) break;
			if (operation.kind === "run")
				this.progress = { beforeTurn: this.authority.turn.turn, stage: this.ordinary.stage };
			if (
				this.pendingRecovery?.boundaryId !== null &&
				this.pendingRecovery?.boundaryId !== undefined &&
				operation.operationId === this.boundaryOperationId(this.pendingRecovery.boundaryId)
			) {
				await this.options.boundary.acknowledge(this.pendingRecovery.boundaryId);
				this.pendingRecovery = null;
			}
			if (this.options.signal?.aborted) await this.lane.abort(this.context);
			const result = await this.lane.drive({ operationId: operation.operationId }, this.context);
			if (!result.ok) throw new Error(`Pi drive rejected: ${result.error._tag}`);
			if (result.value.kind === "waiting") {
				this.waitingOperationId = result.value.operationId;
				steps.push({ kind: "waiting", operationId: result.value.operationId, reason: result.value.reason });
				break;
			}
			steps.push(await this.advanceProgress(await this.settle(result.value.outcome)));
		}
		if (this.nextOpen === this.open.length) this.openResolved = true;
		return steps;
	}

	/** 提交一个新模型 Context；无进展策略最多一次 continuation 和一次恢复。 */
	async prompt(prompt: string): Promise<RuntimeStep> {
		if (this.authority.termination !== null) return { kind: "terminal", terminal: this.authority.termination };
		if (!this.openResolved) throw new Error("open operation must be resolved before a new prompt");
		if (this.waitingOperationId !== null) throw new Error("waiting operation must settle before a new prompt");
		if (this.progress !== null) throw new Error("prior model progress policy is unresolved");
		// RESET 可以在本次进程的上一轮 play 中刚提交；同样需要先让 Pi
		// 持久接纳新 Context，再确认 knowledge boundary 并开放下一次 Action。
		if (this.pendingRecovery === null) {
			const boundary = await this.options.boundary.prepare(this.authority);
			if (boundary !== null) this.pendingRecovery = { prompt: boundary.prompt, boundaryId: boundary.boundaryId };
		}
		this.progress = { beforeTurn: this.authority.turn.turn, stage: this.ordinary.stage };
		if (this.policy.needed && this.pendingRecovery?.boundaryId == null && !(await this.options.pendingCheckpoint())) {
			try {
				if (this.options.requestCheckpoint === undefined) throw new Error("checkpoint anchor gate unavailable");
				await this.options.requestCheckpoint();
			} catch {
				return { kind: "terminal", terminal: await this.authority.finish("checkpoint_failed") };
			}
		}
		this.checkpointDriving = await this.options.pendingCheckpoint();
		if (this.checkpointDriving) this.pendingRecovery = { prompt: CHECKPOINT_PROMPT, boundaryId: null };
		if (this.checkpointDriving && this.checkpointAttempts >= 2)
			return { kind: "terminal", terminal: await this.authority.finish("checkpoint_failed") };
		const outcome = await this.callModel(this.pendingRecovery ?? { prompt, boundaryId: null });
		this.pendingRecovery = null;
		return this.advanceProgress(outcome);
	}

	/** 等待中的 provider operation 结算后，从原阶段继续，而不额外赠送一次模型请求。 */
	private async advanceProgress(outcome: RuntimeStep): Promise<RuntimeStep> {
		const progress = this.progress;
		if (progress === null) return outcome;
		if (outcome.kind === "waiting") return outcome;
		if (this.checkpointTurn !== this.authority.turn.turn) {
			this.checkpointTurn = this.authority.turn.turn;
			this.checkpointAttempts = 0;
			this.checkpointCycles = 0;
		}
		if (outcome.kind !== "terminal" && this.authority.termination === null) {
			if (
				this.policy.needed &&
				!(await this.options.pendingCheckpoint()) &&
				(await this.options.boundary.prepare(this.authority)) === null
			) {
				if (this.options.requestCheckpoint === undefined)
					throw new Error("checkpoint policy requires an anchor gate");
				try {
					await this.options.requestCheckpoint();
				} catch {
					return { kind: "terminal", terminal: await this.authority.finish("checkpoint_failed") };
				}
			}
			if (await this.options.pendingCheckpoint()) {
				if (
					this.policy.input >= this.policy.checkpointLimit ||
					this.checkpointAttempts >= 2 ||
					this.checkpointCycles >= 2
				) {
					this.progress = null;
					return { kind: "terminal", terminal: await this.authority.finish("checkpoint_failed") };
				}
				this.checkpointDriving = true;
				return this.advanceProgress(await this.callModel({ prompt: CHECKPOINT_PROMPT, boundaryId: null }));
			}
			const boundary = await this.options.boundary.prepare(this.authority);
			if (boundary !== null) {
				this.checkpointCycles += 1;
				await this.recordCheckpointPhase("checkpoint.fresh");
				this.checkpointAttempts = 0;
				this.checkpointDriving = false;
				return this.advanceProgress(
					await this.callModel({ prompt: boundary.prompt, boundaryId: boundary.boundaryId }),
				);
			}
		}
		this.checkpointDriving = false;
		if (outcome.kind !== "settled" || outcome.terminal !== null || this.authority.turn.turn !== progress.beforeTurn) {
			this.progress = null;
			this.checkpointCycles = 0;
			return outcome;
		}
		if (progress.stage === 0) {
			progress.stage = 1;
			return this.advanceProgress(
				await this.callModel({ prompt: NONTERMINAL_CONTINUATION_PROMPT, boundaryId: null }),
			);
		}
		if (progress.stage === 1) {
			progress.stage = 2;
			const envelope = await this.options.buildRecoveryEnvelope(this.authority);
			await this.options.evidence.appendRuntime("context.boundary", this.options.now(), {
				reason: "model_no_progress",
				turn: progress.beforeTurn,
			});
			// 回到根上下文，随后只把权威 recovery envelope 交给新 Context。
			const navigation = await this.lane.navigateTree(null, { summarize: false }, this.context);
			if (!navigation.ok) throw new Error(`Pi context boundary rejected: ${navigation.error._tag}`);
			if (navigation.value.navigation.status === "completed") this.prefixMetrics.resetContext();
			this.policy.input = 0;
			this.policy.needed = false;
			return this.advanceProgress(await this.callModel({ prompt: envelope, boundaryId: null }));
		}
		this.progress = null;
		return { kind: "terminal", terminal: await this.authority.finish("model_no_progress") };
	}

	private async recordCheckpointPhase(phase: string): Promise<void> {
		await this.options.evidence.appendRuntime("context.boundary", this.options.now(), {
			phase,
			turn: this.authority.turn.turn,
			observationDigest: this.authority.turn.observationDigest,
		});
	}

	private boundaryOperationId(boundaryId: string): string {
		return `pi-arc-boundary-${boundaryId}`;
	}

	private async callModel(recovery: RecoveryPrompt): Promise<RuntimeStep> {
		if (!this.checkpointDriving && this.progress !== null)
			await this.ordinary.begin(this.authority.turn.turn === this.progress.beforeTurn ? this.progress.stage : 0);
		if (this.options.signal?.aborted) return { kind: "terminal", terminal: await this.authority.finish("cancelled") };
		if ((await this.options.pendingCheckpoint()) && this.policy.input >= this.policy.checkpointLimit)
			return { kind: "terminal", terminal: await this.authority.finish("checkpoint_failed") };
		if (this.checkpointDriving) {
			if (this.checkpointAttempts >= 2)
				return { kind: "terminal", terminal: await this.authority.finish("checkpoint_failed") };
			this.checkpointAttempts += 1;
			await this.recordCheckpointPhase("checkpoint.attempt");
		}
		await this.options.evidence.appendRuntime("model.requested", this.options.now(), {
			provider: this.options.provider,
			modelId: this.options.modelId,
			turn: this.authority.turn.turn,
		});
		if (recovery.boundaryId !== null) {
			if ((await this.lane.getTipId(this.context)) !== null) {
				const navigation = await this.lane.navigateTree(null, { summarize: false }, this.context);
				if (!navigation.ok || navigation.value.navigation.status !== "completed")
					return { kind: "terminal", terminal: await this.authority.finish("checkpoint_failed") };
				this.prefixMetrics.resetContext();
			}
			this.policy.input = 0;
			this.policy.needed = false;
			const images = await this.options.recoveryImages?.(this.authority);
			if ((images?.length ?? 0) > this.policy.imageLimit)
				return { kind: "terminal", terminal: await this.authority.finish("checkpoint_failed") };
			const admission = await this.lane.accept(
				{
					kind: "prompt",
					operationId: this.boundaryOperationId(recovery.boundaryId),
					prompt: recovery.prompt,
					...(images === undefined ? {} : { images }),
				},
				this.context,
			);
			if (!admission.ok) throw new Error(`Pi boundary admission rejected: ${admission.error._tag}`);
			await this.options.boundary.acknowledge(recovery.boundaryId);
			if (this.options.signal?.aborted) await this.lane.abort(this.context);
			const driven = await this.lane.drive({ operationId: admission.value.operationId }, this.context);
			if (!driven.ok) throw new Error(`Pi boundary drive rejected: ${driven.error._tag}`);
			if (driven.value.kind === "waiting") this.waitingOperationId = driven.value.operationId;
			if (driven.value.kind === "waiting")
				return { kind: "waiting", operationId: driven.value.operationId, reason: driven.value.reason };
			return this.settle(driven.value.outcome);
		}
		const images =
			recovery.prompt === NONTERMINAL_CONTINUATION_PROMPT || this.checkpointDriving
				? undefined
				: await this.options.recoveryImages?.(this.authority);
		const entries = await this.lane.findEntries({ type: "message", order: "oldestFirst" }, this.context);
		const existingImages = countContextImages(
			entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : [])),
		);
		if (existingImages > this.policy.imageLimit)
			return { kind: "terminal", terminal: await this.authority.finish("checkpoint_failed") };
		if (existingImages + (images?.length ?? 0) > this.policy.imageLimit) {
			await this.options.evidence.appendRuntime("context.boundary", this.options.now(), {
				reason: "image_capacity",
				turn: this.authority.turn.turn,
			});
			try {
				if (this.options.requestCheckpoint === undefined) throw new Error("checkpoint anchor gate unavailable");
				await this.options.requestCheckpoint();
			} catch {
				return { kind: "terminal", terminal: await this.authority.finish("checkpoint_failed") };
			}
			this.policy.needed = true;
			this.checkpointDriving = true;
			return this.callModel({ prompt: CHECKPOINT_PROMPT, boundaryId: null });
		}
		const admission = await this.lane.accept(
			{ kind: "prompt", prompt: recovery.prompt, ...(images === undefined ? {} : { images }) },
			this.context,
		);
		if (!admission.ok) throw new Error(`Pi prompt rejected: ${admission.error._tag}`);
		// Covers cancellation while accept was persisting, when the listener
		// could have observed no active operation yet.
		if (this.options.signal?.aborted) await this.lane.abort(this.context);
		const driven = await this.lane.drive(
			{ operationId: admission.value.operationId, waitForRetry: true },
			this.context,
		);
		if (!driven.ok) throw new Error(`Pi prompt drive rejected: ${driven.error._tag}`);
		if (driven.value.kind === "waiting") {
			this.waitingOperationId = driven.value.operationId;
			return { kind: "waiting", operationId: driven.value.operationId, reason: driven.value.reason };
		}
		return this.settle(driven.value.outcome);
	}

	/** 只继续先前已接纳的等待操作，不创建新的模型请求或 Action。 */
	async resumeWaiting(): Promise<RuntimeStep> {
		if (this.authority.termination !== null) return { kind: "terminal", terminal: this.authority.termination };
		const operationId = this.waitingOperationId;
		if (operationId === null) throw new Error("no waiting Pi operation");
		if (this.options.signal?.aborted) await this.lane.abort(this.context);
		const driven = await this.lane.drive({ operationId, pollDeferred: true }, this.context);
		if (!driven.ok) throw new Error(`Pi waiting drive rejected: ${driven.error._tag}`);
		if (driven.value.kind === "waiting")
			return { kind: "waiting", operationId: driven.value.operationId, reason: driven.value.reason };
		this.waitingOperationId = null;
		if (this.open[this.nextOpen]?.operationId === operationId) {
			this.nextOpen += 1;
			if (this.nextOpen === this.open.length) this.openResolved = true;
		}
		return this.advanceProgress(await this.settle(driven.value.outcome));
	}

	private async settle(result: OperationResultRecord): Promise<RuntimeStep> {
		await this.options.evidence.appendRuntime("model.responded", this.options.now(), {
			operationId: result.operationId,
			status: result.status,
			...(result.error === undefined ? {} : { code: result.error.code }),
		});
		if (this.options.signal?.aborted)
			return {
				kind: "terminal",
				terminal: this.authority.termination ?? (await this.authority.finish("cancelled")),
			};
		if (result.status === "failed" || result.status === "declined") {
			const terminal =
				this.authority.termination ??
				(await this.authority.finish(this.checkpointDriving ? "checkpoint_failed" : "model_failure"));
			return { kind: "terminal", terminal };
		}
		return { kind: "settled", result, terminal: this.authority.termination };
	}

	async close(): Promise<void> {
		this.options.signal?.removeEventListener("abort", this.onAbort);
		await this.cancellation.catch(() => undefined);
		// A cancelled caller must not cancel mandatory harness/session cleanup.
		await this.harness.close(this.options.context ?? TODO_CONTEXT);
	}
}
