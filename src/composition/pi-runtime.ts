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
import type { Api, Model, Models } from "@earendil-works/pi-ai";
import { NONTERMINAL_CONTINUATION_PROMPT } from "../application/model-prompts.js";
import type { ModelToolExecutor } from "../application/model-tools.js";
import type { TerminalRecord, TerminationReason, Turn } from "../application/run-controller.js";
import { PiToolAdapter, type PiToolEvidence } from "./pi-tools.js";

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
	boundary: {
		/** 从已提交 RESET/checkpoint 准备同一个可重放的模型恢复消息。 */
		prepare(authority: RuntimeAuthority): Promise<{ boundaryId: string; prompt: string } | null>;
		/** Pi prompt operation 已持久接纳后，才解除 Action boundary gate。 */
		acknowledge(boundaryId: string): Promise<void>;
	};
	context?: Context;
}

interface RecoveryPrompt {
	prompt: string;
	boundaryId: string | null;
}

export type RuntimeStep =
	| { kind: "settled"; result: OperationResultRecord; terminal: TerminalRecord | null }
	| { kind: "waiting"; operationId: string; reason: "retry" | "deferred" }
	| { kind: "terminal"; terminal: TerminalRecord };

function isSettled(value: { status: string }): value is OperationResultRecord {
	return value.status !== "suspended";
}

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
	private readonly lane: AgentLane;
	private readonly options: PiRuntimeOptions;
	private readonly context: Context;
	private pendingRecovery: RecoveryPrompt | null;
	private openResolved: boolean;
	private nextOpen = 0;
	private waitingOperationId: string | null = null;
	private progress: { beforeTurn: number; stage: 0 | 1 | 2 } | null = null;

	private constructor(
		options: PiRuntimeOptions,
		harness: Harness<undefined>,
		lane: AgentLane,
		open: OpenOperation[],
		authority: RuntimeAuthority,
		pendingRecovery: RecoveryPrompt | null,
	) {
		this.options = options;
		this.harness = harness;
		this.lane = lane;
		this.open = open;
		this.authority = authority;
		this.pendingRecovery = pendingRecovery;
		this.context = options.context ?? TODO_CONTEXT;
		this.openResolved = open.length === 0;
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
			},
			context,
		);
		const lane = await created.harness.lane(options.laneId, context);
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
		return new PiArcRuntime(options, created.harness, lane, open, authority, pendingRecovery);
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
			if (operation.kind === "run") this.progress = { beforeTurn: this.authority.turn.turn, stage: 0 };
			if (
				this.pendingRecovery?.boundaryId !== null &&
				this.pendingRecovery?.boundaryId !== undefined &&
				operation.operationId === this.boundaryOperationId(this.pendingRecovery.boundaryId)
			) {
				await this.options.boundary.acknowledge(this.pendingRecovery.boundaryId);
				this.pendingRecovery = null;
			}
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
		this.progress = { beforeTurn: this.authority.turn.turn, stage: 0 };
		const outcome = await this.callModel(this.pendingRecovery ?? { prompt, boundaryId: null });
		this.pendingRecovery = null;
		return this.advanceProgress(outcome);
	}

	/** 等待中的 provider operation 结算后，从原阶段继续，而不额外赠送一次模型请求。 */
	private async advanceProgress(outcome: RuntimeStep): Promise<RuntimeStep> {
		const progress = this.progress;
		if (progress === null) return outcome;
		if (outcome.kind === "waiting") return outcome;
		if (outcome.kind !== "settled" || outcome.terminal !== null || this.authority.turn.turn !== progress.beforeTurn) {
			this.progress = null;
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
			return this.advanceProgress(await this.callModel({ prompt: envelope, boundaryId: null }));
		}
		this.progress = null;
		return { kind: "terminal", terminal: await this.authority.finish("model_no_progress") };
	}

	private boundaryOperationId(boundaryId: string): string {
		return `pi-arc-boundary-${boundaryId}`;
	}

	private async callModel(recovery: RecoveryPrompt): Promise<RuntimeStep> {
		await this.options.evidence.appendRuntime("model.requested", this.options.now(), {
			provider: this.options.provider,
			modelId: this.options.modelId,
			turn: this.authority.turn.turn,
		});
		if (recovery.boundaryId !== null) {
			const admission = await this.lane.accept(
				{ kind: "prompt", operationId: this.boundaryOperationId(recovery.boundaryId), prompt: recovery.prompt },
				this.context,
			);
			if (!admission.ok) throw new Error(`Pi boundary admission rejected: ${admission.error._tag}`);
			await this.options.boundary.acknowledge(recovery.boundaryId);
			const driven = await this.lane.drive({ operationId: admission.value.operationId }, this.context);
			if (!driven.ok) throw new Error(`Pi boundary drive rejected: ${driven.error._tag}`);
			if (driven.value.kind === "waiting") this.waitingOperationId = driven.value.operationId;
			if (driven.value.kind === "waiting")
				return { kind: "waiting", operationId: driven.value.operationId, reason: driven.value.reason };
			return this.settle(driven.value.outcome);
		}
		const result = await this.lane.prompt(recovery.prompt, undefined, this.context);
		if (!result.ok) throw new Error(`Pi prompt rejected: ${result.error._tag}`);
		if (!isSettled(result.value)) {
			this.waitingOperationId = result.value.operationId;
			return { kind: "waiting", operationId: result.value.operationId, reason: "deferred" };
		}
		return this.settle(result.value);
	}

	/** 只继续先前已接纳的等待操作，不创建新的模型请求或 Action。 */
	async resumeWaiting(): Promise<RuntimeStep> {
		if (this.authority.termination !== null) return { kind: "terminal", terminal: this.authority.termination };
		const operationId = this.waitingOperationId;
		if (operationId === null) throw new Error("no waiting Pi operation");
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
		if (result.status === "failed" || result.status === "declined") {
			const terminal = this.authority.termination ?? (await this.authority.finish("model_failure"));
			return { kind: "terminal", terminal };
		}
		return { kind: "settled", result, terminal: this.authority.termination };
	}

	async close(): Promise<void> {
		await this.harness.close(this.context);
	}
}
