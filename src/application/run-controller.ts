/**
 * 单局 ARC Run 的权威生命周期控制器。
 *
 * 只依赖持久化、视觉发布和 Environment ports；Pi 的 tool settlement 不能
 * 替代 receipt/Turn commit。所有恢复均从 domain ledger 和同一实例查询开始。
 */

import { normalizeRawFrame, renderVisual, type Visual } from "../domain/game-visual.js";
import { canonicalJson, type JsonValue } from "../protocol/canonical-json.js";

/** controller 只约束所需形状；具体 artifact/哈希实现由 composition 注入。 */
export type ArtifactRecordType =
	| "run.binding"
	| "action.intent"
	| "environment.receipt"
	| "turn.commit"
	| "tool.rejection"
	| "knowledge.commit"
	| "context.boundary"
	| "terminal.intent"
	| "post_terminal.evidence";
export interface ArtifactManifest extends Record<string, JsonValue> {
	schema: "pi-arc.run-manifest.v1";
	runId: string;
}
export interface DomainRecord extends Record<string, JsonValue> {
	schema: "pi-arc.domain-record.v1";
	sequence: number;
	recordedAt: string;
	recordType: ArtifactRecordType;
	previousDigest: string;
	digest: string;
	payload: Record<string, JsonValue>;
}
export interface RawFrame extends Record<string, JsonValue> {
	schema: "pi-arc.raw-frame.v1";
	width: number;
	height: number;
	pixels: number[][];
	runId: string;
	environmentInstanceId: string;
	turn: number;
	frame: number;
	actionId: string | null;
	contentDigest: string;
}
export interface TerminalRecord extends Record<string, JsonValue> {
	schema: "pi-arc.terminal.v1";
	runId: string;
	outcomeClass: "win" | "non_success" | "unknown_outcome" | "audit_failure";
	terminationReason: string;
	lastCommittedTurn: number;
	ledgerHead: string;
	recordedAt: string;
}

export type GameState = "NOT_PLAYED" | "NOT_FINISHED" | "GAME_OVER" | "WIN";
export type ActionName = "RESET" | "ACTION1" | "ACTION2" | "ACTION3" | "ACTION4" | "ACTION5" | "ACTION6" | "ACTION7";
export type TerminationReason =
	| "WIN"
	| "action_budget_exhausted"
	| "model_failure"
	| "model_no_progress"
	| "checkpoint_failed"
	| "environment_lost"
	| "evidence_incomplete"
	| "evidence_corrupt"
	| "unknown_action_outcome"
	| "cancelled"
	| "controller_failure";

export interface GameAction extends Record<string, JsonValue> {
	name: ActionName;
	data: Record<string, JsonValue>;
}

export interface Observation extends Record<string, JsonValue> {
	state: GameState;
	levelsCompleted: number;
	winLevels: number;
	availableActions: ActionName[];
}

export interface Turn extends Record<string, JsonValue> {
	turn: number;
	observation: Observation;
	observationDigest: string;
	level: number;
	attempt: number;
	attemptStatus: "active" | "ended";
	actionId: string | null;
}

export interface ControllerArtifacts {
	writeManifest(manifest: ArtifactManifest): Promise<void>;
	appendDomain(type: ArtifactRecordType, at: string, payload: Record<string, JsonValue>): Promise<DomainRecord>;
	writeRawFrame(frame: RawFrame): Promise<string>;
	writeVisualReference(reference: {
		visualRef: string;
		framePath: string;
		turn: number;
		frame: number;
	}): Promise<void>;
	writeTerminal(terminal: TerminalRecord): Promise<void>;
	appendLateEvidence(at: string, payload: Record<string, JsonValue>): Promise<DomainRecord>;
	readDomain(): Promise<readonly DomainRecord[]>;
	readTerminal(): Promise<TerminalRecord | undefined>;
}

export interface ControllerEnvironment {
	open(): Promise<Record<string, unknown>>;
	request(
		type: "get_anchor" | "submit_action" | "lookup_action",
		payload: Record<string, unknown>,
	): Promise<Record<string, unknown>>;
}

export interface ControllerVisuals {
	publish(turn: number, frame: number, visual: Visual): Promise<string>;
}

export interface ControllerPorts {
	artifacts: ControllerArtifacts;
	environment: ControllerEnvironment;
	visuals: ControllerVisuals;
	now(): string;
	digest(value: JsonValue): string;
}

export interface RunBinding {
	manifest: ArtifactManifest;
	sessionId: string;
	laneId: string;
}

export interface PlayRequest {
	actionId: string;
	invocationId: string;
	action: GameAction;
	retryState?: string;
}

interface ActionIntent {
	actionId: string;
	invocationId: string;
	environmentInstanceId: string;
	baseTurn: number;
	baseObservationDigest: string;
	action: GameAction;
	retryState: string | null;
}

interface CompleteReceipt extends Record<string, JsonValue> {
	actionId: string;
	status: "complete";
	environmentInstanceId: string;
	baseTurn: number;
	baseObservationDigest: string;
	action: GameAction;
	turn: number;
	observation: Observation;
	frames: number[][][];
	resultState: GameState;
	receiptDigest: string;
}

/** 拒绝发生在 Environment effect admission 之前，不创建 Turn。 */
export class ActionRejectedError extends Error {
	readonly code = "action_rejected";
}

/** 已有 Action 的结果不可证明，任何新的 Action 都必须 fail closed。 */
export class UnknownActionOutcomeError extends Error {
	readonly code = "unknown_action_outcome";
}

/** 环境结果已知，但本地 Evidence 尚未完整发布；只允许后续恢复补写。 */
export class ReceiptCommitError extends Error {
	readonly code = "receipt_commit_failed";
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} is not an object`);
	return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`);
	return value;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is invalid`);
	return value;
}

function observation(value: unknown): Observation {
	const source = record(value, "Observation");
	const state = source.state;
	if (state !== "NOT_PLAYED" && state !== "NOT_FINISHED" && state !== "GAME_OVER" && state !== "WIN")
		throw new Error("Observation state is invalid");
	if (!Array.isArray(source.availableActions) || !source.availableActions.every((item) => typeof item === "string"))
		throw new Error("Observation availableActions are invalid");
	return {
		state,
		levelsCompleted: integer(source.levelsCompleted, "levelsCompleted"),
		winLevels: integer(source.winLevels, "winLevels"),
		availableActions: source.availableActions as ActionName[],
	};
}

function frames(value: unknown): number[][][] {
	if (!Array.isArray(value) || value.length === 0) throw new Error("receipt has no Raw Frames");
	return value.map((frame) => normalizeRawFrame(frame).pixels);
}

function action(value: unknown): GameAction {
	const source = record(value, "Action");
	const name = source.name;
	if (
		typeof name !== "string" ||
		!["RESET", "ACTION1", "ACTION2", "ACTION3", "ACTION4", "ACTION5", "ACTION6", "ACTION7"].includes(name)
	)
		throw new ActionRejectedError("Action name is invalid");
	const data = record(source.data, "Action data");
	if (name === "ACTION6") {
		if (
			Object.keys(data).sort().join(",") !== "x,y" ||
			![data.x, data.y].every(
				(coordinate) =>
					typeof coordinate === "number" && Number.isInteger(coordinate) && coordinate >= 0 && coordinate <= 63,
			)
		)
			throw new ActionRejectedError("ACTION6 requires mapped 0..63 coordinates");
	} else if (Object.keys(data).length !== 0) throw new ActionRejectedError("Action data must be empty");
	return { name: name as ActionName, data: data as Record<string, JsonValue> };
}

function intentFrom(recordValue: DomainRecord): ActionIntent {
	const value = recordValue.payload;
	return {
		actionId: string(value.actionId, "actionId"),
		invocationId: string(value.invocationId, "invocationId"),
		environmentInstanceId: string(value.environmentInstanceId, "environmentInstanceId"),
		baseTurn: integer(value.baseTurn, "baseTurn"),
		baseObservationDigest: string(value.baseObservationDigest, "baseObservationDigest"),
		action: action(value.action),
		retryState: typeof value.retryState === "string" ? value.retryState : null,
	};
}

function receiptFrom(value: unknown, intent: ActionIntent, digest: (value: JsonValue) => string): CompleteReceipt {
	const source = record(value, "receipt");
	if (source.status !== "complete") throw new Error("receipt is not complete");
	const received = {
		actionId: string(source.actionId, "receipt.actionId"),
		status: "complete" as const,
		environmentInstanceId: string(source.environmentInstanceId, "receipt.environmentInstanceId"),
		baseTurn: integer(source.baseTurn, "receipt.baseTurn"),
		baseObservationDigest: string(source.baseObservationDigest, "receipt.baseObservationDigest"),
		action: action(source.action),
		turn: integer(source.turn, "receipt.turn"),
		observation: observation(source.observation),
		frames: frames(source.frames),
		resultState: source.resultState as GameState,
		receiptDigest: string(source.receiptDigest, "receipt.receiptDigest"),
	};
	const { receiptDigest: _digest, ...digestable } = received;
	if (
		received.actionId !== intent.actionId ||
		received.environmentInstanceId !== intent.environmentInstanceId ||
		received.baseTurn !== intent.baseTurn ||
		received.baseObservationDigest !== intent.baseObservationDigest ||
		received.turn !== intent.baseTurn + 1 ||
		received.resultState !== received.observation.state ||
		canonicalJson(received.action) !== canonicalJson(intent.action) ||
		digest(digestable) !== received.receiptDigest
	)
		throw new Error("receipt identity, base anchor, or digest mismatch");
	return received;
}

function turnFrom(recordValue: DomainRecord): Turn {
	const value = recordValue.payload;
	if (value.attemptStatus !== "active" && value.attemptStatus !== "ended")
		throw new Error("Attempt status is invalid");
	return {
		turn: integer(value.turn, "Turn"),
		observation: observation(value.observation),
		observationDigest: string(value.observationDigest, "Observation digest"),
		level: integer(value.level, "Level"),
		attempt: integer(value.attempt, "Attempt"),
		attemptStatus: value.attemptStatus,
		actionId: typeof value.actionId === "string" ? value.actionId : null,
	};
}

/** 状态只从 commit 推进；intent 或 receipt 不能自行改变当前 Turn。 */
export class RunController {
	readonly runId: string;
	readonly environmentInstanceId: string;
	private current: Turn;
	private readonly ports: ControllerPorts;
	private pending: ActionIntent | null = null;
	private terminal: TerminalRecord | null = null;
	private gateOpen = true;
	private settleTail: Promise<void> = Promise.resolve();

	private constructor(runId: string, instanceId: string, current: Turn, ports: ControllerPorts) {
		this.runId = runId;
		this.environmentInstanceId = instanceId;
		this.current = current;
		this.ports = ports;
	}

	get turn(): Turn {
		return this.current;
	}
	get termination(): TerminalRecord | null {
		return this.terminal;
	}

	/** 初始 Frame 全部发布并完成 Turn 0 后，Run 才可以接受 Action。 */
	static async start(binding: RunBinding, ports: ControllerPorts): Promise<RunController> {
		await ports.artifacts.writeManifest(binding.manifest);
		const opened = await ports.environment.open();
		const anchor = record(opened.anchor, "initial anchor");
		const instanceId = string(opened.environmentInstanceId, "environmentInstanceId");
		const initial = observation(opened.observation);
		if (
			anchor.environmentInstanceId !== instanceId ||
			anchor.turn !== 0 ||
			anchor.observationDigest !== ports.digest(initial)
		)
			throw new Error("initial Environment anchor mismatch");
		const initialTurn: Turn = {
			turn: 0,
			observation: initial,
			observationDigest: string(anchor.observationDigest, "initial digest"),
			level: initial.levelsCompleted + 1,
			attempt: 1,
			attemptStatus: initial.state === "GAME_OVER" || initial.state === "WIN" ? "ended" : "active",
			actionId: null,
		};
		const controller = new RunController(binding.manifest.runId, instanceId, initialTurn, ports);
		await controller.publishFrames(0, null, frames(opened.frames));
		await ports.artifacts.appendDomain("run.binding", ports.now(), {
			runId: controller.runId,
			game: binding.manifest.game ?? null,
			sessionId: binding.sessionId,
			laneId: binding.laneId,
			environmentInstanceId: instanceId,
			turn: 0,
			observationDigest: initialTurn.observationDigest,
			level: initialTurn.level,
			attempt: initialTurn.attempt,
			generation: 0,
		});
		await controller.commitTurn(initialTurn, null);
		if (initial.state === "WIN") await controller.finish("WIN");
		return controller;
	}

	/** 从 ledger 和同一 Environment 实例恢复；绝不重放 Action log。 */
	static async recover(runId: string, ports: ControllerPorts): Promise<RunController> {
		const records = await ports.artifacts.readDomain();
		const binding = records.find((entry) => entry.recordType === "run.binding");
		const committed = records.filter((entry) => entry.recordType === "turn.commit");
		if (binding === undefined || committed.length === 0 || binding.payload.runId !== runId)
			throw new Error("Run binding or Turn 0 is incomplete");
		const instanceId = string(binding.payload.environmentInstanceId, "environmentInstanceId");
		const controller = new RunController(runId, instanceId, turnFrom(committed.at(-1) as DomainRecord), ports);
		if (ports.digest(controller.current.observation) !== controller.current.observationDigest)
			throw new Error("committed Observation digest is invalid");
		controller.terminal = (await ports.artifacts.readTerminal()) ?? null;
		if (controller.terminal !== null) {
			if (controller.terminal.runId !== runId) throw new Error("terminal belongs to another Run");
			controller.gateOpen = false;
			return controller;
		}
		const terminalIntent = [...records].reverse().find((entry) => entry.recordType === "terminal.intent");
		if (terminalIntent !== undefined) {
			controller.gateOpen = false;
			await controller.publishTerminal(
				terminalIntent,
				string(terminalIntent.payload.reason, "terminal reason") as TerminationReason,
			);
			return controller;
		}
		const lastIntent = [...records].reverse().find((entry) => entry.recordType === "action.intent");
		if (
			lastIntent !== undefined &&
			!committed.some((entry) => entry.payload.actionId === lastIntent.payload.actionId)
		) {
			controller.pending = intentFrom(lastIntent);
			const savedReceipt = [...records]
				.reverse()
				.find(
					(entry) =>
						entry.recordType === "environment.receipt" && entry.payload.actionId === lastIntent.payload.actionId,
				);
			if (savedReceipt !== undefined) {
				const receipt = receiptFrom(savedReceipt.payload, controller.pending, ports.digest);
				await controller.commitReceipt(receipt, controller.pending);
				return controller;
			}
			await controller.reconcile();
			return controller;
		}
		// WIN 的权威 Turn 已持久化时，无需复活 Environment 也能完成终止。
		if (controller.current.observation.state === "WIN") {
			await controller.finish("WIN");
			return controller;
		}
		try {
			const response = await ports.environment.request("get_anchor", { environmentInstanceId: instanceId });
			const anchor = record(response.anchor, "Environment anchor");
			if (
				anchor.environmentInstanceId !== instanceId ||
				anchor.turn !== controller.current.turn ||
				anchor.observationDigest !== controller.current.observationDigest
			)
				throw new Error("Environment anchor differs from last Turn commit");
		} catch {
			await controller.finish("environment_lost");
		}
		return controller;
	}

	/** 每次只接纳一个 Action；非法输入在 intent 前留下可审计拒绝。 */
	async play(request: PlayRequest): Promise<Turn> {
		if (!this.gateOpen || this.terminal !== null || this.pending !== null)
			throw new ActionRejectedError("Run does not admit another Action");
		let checked: GameAction;
		try {
			checked = action(request.action);
			if (!request.actionId || !request.invocationId) throw new ActionRejectedError("Action identity is required");
			if (this.current.observation.state === "GAME_OVER" && checked.name !== "RESET")
				throw new ActionRejectedError("GAME_OVER requires RESET");
			if (
				this.current.observation.state === "WIN" ||
				!this.current.observation.availableActions.includes(checked.name)
			)
				throw new ActionRejectedError("Action is unavailable");
			if (checked.name === "RESET" && this.current.observation.state !== "GAME_OVER")
				throw new ActionRejectedError("RESET requires GAME_OVER");
			if (checked.name === "RESET" && (!request.retryState || request.retryState.trim().length === 0))
				throw new ActionRejectedError("RESET requires retry_state");
			if (checked.name !== "RESET" && request.retryState !== undefined)
				throw new ActionRejectedError("retry_state is only for RESET");
		} catch (error) {
			await this.ports.artifacts.appendDomain("tool.rejection", this.ports.now(), {
				actionId: request.actionId,
				reason: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
		const intent: ActionIntent = {
			actionId: request.actionId,
			invocationId: request.invocationId,
			environmentInstanceId: this.environmentInstanceId,
			baseTurn: this.current.turn,
			baseObservationDigest: this.current.observationDigest,
			action: checked,
			retryState: request.retryState ?? null,
		};
		// pending 与 gate 在首个 await 前置位，避免两个并发 play 越过 admission。
		this.pending = intent;
		try {
			const records = await this.ports.artifacts.readDomain();
			if (
				records.some((entry) => entry.recordType === "action.intent" && entry.payload.actionId === request.actionId)
			)
				throw new ActionRejectedError("actionId was already used");
			await this.ports.artifacts.appendDomain("action.intent", this.ports.now(), { ...intent });
		} catch (error) {
			if (error instanceof ActionRejectedError) {
				this.pending = null;
				await this.ports.artifacts.appendDomain("tool.rejection", this.ports.now(), {
					actionId: request.actionId,
					reason: error.message,
				});
			} else {
				// 写入报错不证明 intent 未发布：先查 durable ledger；查不清时
				// 关闭 admission，绝不能在同一 Run 放行下一条 Action。
				this.gateOpen = false;
				try {
					const records = await this.ports.artifacts.readDomain();
					if (
						!records.some(
							(entry) => entry.recordType === "action.intent" && entry.payload.actionId === intent.actionId,
						)
					)
						this.pending = null;
				} catch {
					/* ledger 不可读时保持 pending 与关闭状态 */
				}
			}
			throw error;
		}
		return this.submit(intent);
	}

	private async submit(intent: ActionIntent, maySubmitAfterNegative = true): Promise<Turn> {
		try {
			const response = await this.ports.environment.request("submit_action", this.actionPayload(intent));
			return await this.settleResponse(response, intent);
		} catch (error) {
			if (error instanceof ReceiptCommitError) throw error;
			if (this.terminal !== null) throw new UnknownActionOutcomeError("Action result arrived after Run termination");
			return this.reconcile(maySubmitAfterNegative);
		}
	}

	private actionPayload(intent: ActionIntent): Record<string, unknown> {
		return {
			environmentInstanceId: intent.environmentInstanceId,
			actionId: intent.actionId,
			baseTurn: intent.baseTurn,
			baseObservationDigest: intent.baseObservationDigest,
			action: intent.action,
		};
	}

	private settleResponse(response: Record<string, unknown>, intent: ActionIntent): Promise<Turn> {
		const envelope = record(response.receipt, "receipt envelope");
		if (envelope.status !== "complete") return this.reconcile();
		return this.serial(async () => {
			if (this.terminal !== null) {
				await this.ports.artifacts.appendLateEvidence(this.ports.now(), {
					actionId: intent.actionId,
					receipt: envelope as Record<string, JsonValue>,
				});
				throw new UnknownActionOutcomeError("receipt arrived after terminal");
			}
			if (this.pending === null) return this.current;
			const receipt = receiptFrom(envelope, intent, this.ports.digest);
			try {
				await this.commitReceipt(receipt, intent);
			} catch (error) {
				this.gateOpen = false;
				throw new ReceiptCommitError(error instanceof Error ? error.message : String(error));
			}
			return this.current;
		});
	}

	/** 只允许 lookup；not_accepted 是权威 negative acknowledgement 后的首次提交。 */
	async reconcile(maySubmitAfterNegative = true): Promise<Turn> {
		if (this.terminal !== null) throw new UnknownActionOutcomeError("Run has terminated");
		const intent = this.pending;
		if (intent === null) return this.current;
		try {
			const response = await this.ports.environment.request("lookup_action", {
				environmentInstanceId: intent.environmentInstanceId,
				actionId: intent.actionId,
				baseTurn: intent.baseTurn,
				baseObservationDigest: intent.baseObservationDigest,
			});
			const receipt = record(response.receipt, "lookup receipt");
			if (receipt.status === "complete") return await this.settleResponse(response, intent);
			if (
				maySubmitAfterNegative &&
				receipt.status === "not_accepted" &&
				receipt.environmentInstanceId === intent.environmentInstanceId &&
				receipt.actionId === intent.actionId &&
				receipt.baseTurn === intent.baseTurn &&
				receipt.baseObservationDigest === intent.baseObservationDigest &&
				this.terminal === null &&
				this.gateOpen
			) {
				return this.submit(intent, false);
			}
		} catch (error) {
			if (error instanceof ReceiptCommitError) throw error;
			// 查询失败、矛盾或 pending 均没有可证明的 Action 完成结果。
		}
		await this.serial(async () => {
			if (this.terminal === null) await this.finishLocked("unknown_action_outcome");
		});
		throw new UnknownActionOutcomeError("Action result cannot be established on the same Environment instance");
	}

	/** 取消先关 admission，再处理 pending；未知结果优先于 cancelled。 */
	async cancel(): Promise<TerminalRecord> {
		this.gateOpen = false;
		if (this.pending !== null && this.terminal === null) {
			try {
				await this.reconcile();
			} catch {
				/* reconcile 已持久化 Unknown Outcome */
			}
		}
		return this.serial(async () => {
			if (this.terminal === null) await this.finishLocked("cancelled");
			return this.terminal as TerminalRecord;
		});
	}

	/** 已知终止仍需先关闭 effect admission，并且不能覆盖既有 terminal。 */
	async finish(reason: TerminationReason): Promise<TerminalRecord> {
		this.gateOpen = false;
		if (this.pending !== null && this.terminal === null) {
			try {
				await this.reconcile();
			} catch {
				// 无法确认的 Action 已优先以 Unknown Outcome 终止。
				if (this.terminal !== null) return this.terminal;
				throw new Error("pending Action could not be classified");
			}
		}
		return this.serial(async () => {
			if (reason === "WIN" && this.current.observation.state !== "WIN")
				throw new Error("WIN requires a committed authority Observation");
			await this.finishLocked(reason);
			return this.terminal as TerminalRecord;
		});
	}

	private async finishLocked(reason: TerminationReason): Promise<void> {
		if (this.terminal !== null) return;
		if (this.pending !== null && reason !== "unknown_action_outcome")
			throw new Error("pending Action must be reconciled before terminal");
		const records = await this.ports.artifacts.readDomain();
		const existing = [...records].reverse().find((entry) => entry.recordType === "terminal.intent");
		if (existing !== undefined && existing.payload.reason !== reason)
			throw new Error("terminal reason conflicts with prior intent");
		const intent =
			existing ??
			(await this.ports.artifacts.appendDomain("terminal.intent", this.ports.now(), {
				reason,
				lastCommittedTurn: this.current.turn,
				level: this.current.level,
				attempt: this.current.attempt,
				attemptStatus: "ended",
			}));
		await this.publishTerminal(intent, reason);
	}

	private async publishTerminal(intent: DomainRecord, reason: TerminationReason): Promise<void> {
		if (reason === "WIN" && this.current.observation.state !== "WIN")
			throw new Error("WIN requires a committed authority Observation");
		const terminal: TerminalRecord = {
			schema: "pi-arc.terminal.v1",
			runId: this.runId,
			outcomeClass:
				reason === "WIN"
					? "win"
					: reason === "unknown_action_outcome"
						? "unknown_outcome"
						: reason === "evidence_corrupt" || reason === "controller_failure"
							? "audit_failure"
							: "non_success",
			terminationReason: reason,
			lastCommittedTurn: this.current.turn,
			ledgerHead: intent.digest,
			recordedAt: intent.recordedAt,
		};
		await this.ports.artifacts.writeTerminal(terminal);
		this.terminal = terminal;
		this.pending = null;
	}

	private async commitReceipt(receipt: CompleteReceipt, intent: ActionIntent): Promise<void> {
		await this.publishFrames(receipt.turn, intent.actionId, receipt.frames);
		const records = await this.ports.artifacts.readDomain();
		const existingTurn = records.find(
			(entry) => entry.recordType === "turn.commit" && entry.payload.actionId === intent.actionId,
		);
		if (existingTurn !== undefined) {
			if (existingTurn.payload.receiptDigest !== receipt.receiptDigest)
				throw new Error("Turn commit conflicts with receipt");
			this.current = turnFrom(existingTurn);
			this.pending = null;
			return;
		}
		if (
			!records.some(
				(entry) => entry.recordType === "environment.receipt" && entry.payload.actionId === intent.actionId,
			)
		)
			await this.ports.artifacts.appendDomain("environment.receipt", this.ports.now(), { ...receipt });
		const levelChanged = receipt.observation.levelsCompleted > this.current.observation.levelsCompleted;
		const next: Turn = {
			turn: receipt.turn,
			observation: receipt.observation,
			observationDigest: this.ports.digest(receipt.observation),
			level: levelChanged ? receipt.observation.levelsCompleted + 1 : this.current.level,
			attempt: levelChanged ? 1 : intent.action.name === "RESET" ? this.current.attempt + 1 : this.current.attempt,
			attemptStatus:
				receipt.resultState === "GAME_OVER" || receipt.resultState === "WIN" || levelChanged ? "ended" : "active",
			actionId: intent.actionId,
		};
		if (levelChanged && receipt.resultState !== "WIN") next.attemptStatus = "active";
		// RESET 的 retry_state 与新 Attempt 边界在同一 Turn commit 中生效；
		// WP-07 再把该已提交值物化为活动 WORKING 和 delivery envelope。
		await this.commitTurn(next, receipt.receiptDigest, intent.action.name === "RESET" ? intent.retryState : null);
		this.current = next;
		this.pending = null;
		if (receipt.resultState === "WIN") {
			this.gateOpen = false;
			await this.finishLocked("WIN");
		}
	}

	private async commitTurn(turn: Turn, receiptDigest: string | null, retryState: string | null = null): Promise<void> {
		await this.ports.artifacts.appendDomain("turn.commit", this.ports.now(), {
			...turn,
			receiptDigest,
			retryState,
			boundaryPending: retryState !== null,
		});
	}

	private async publishFrames(turn: number, actionId: string | null, values: number[][][]): Promise<void> {
		for (const [index, pixels] of values.entries()) {
			if (pixels === undefined) throw new Error("Raw Frame is missing");
			const normalized = normalizeRawFrame(pixels);
			const frame: RawFrame = {
				schema: "pi-arc.raw-frame.v1",
				width: normalized.width,
				height: normalized.height,
				pixels: normalized.pixels,
				runId: this.runId,
				environmentInstanceId: this.environmentInstanceId,
				turn,
				frame: index,
				actionId,
				contentDigest: this.ports.digest({
					width: normalized.width,
					height: normalized.height,
					pixels: normalized.pixels,
				}),
			};
			const framePath = await this.ports.artifacts.writeRawFrame(frame);
			const visualRef = await this.ports.visuals.publish(turn, index, renderVisual(normalized.pixels));
			await this.ports.artifacts.writeVisualReference({ visualRef, framePath, turn, frame: index });
		}
	}

	private serial<T>(task: () => Promise<T>): Promise<T> {
		const result = this.settleTail.then(task);
		this.settleTail = result.then(
			() => {},
			() => {},
		);
		return result;
	}
}
