/**
 * provider-neutral 的模型工具协议与 GUIDE/WORKING/checkpoint 编排。
 *
 * 本模块只处理可观察输入、输出、限制和 safe replay；Environment、artifact
 * filesystem、PNG 读取与 Pi tool loop 都通过 ports 注入，避免把模型 transcript
 * 或运行时状态伪装成 ARC Environment Evidence。
 */

import {
	mapAction6Point,
	type Rgb,
	renderInspectionRegion,
	sampleVisualRegion,
	type Visual,
	type VisualRegion,
} from "../domain/game-visual.js";
import type { JsonValue } from "../protocol/canonical-json.js";

export const TOOL_SCHEMA = "pi-arc.tool-call.v1" as const;
export const RESULT_SCHEMA = "pi-arc.tool-result.v1" as const;
export const MAX_GUIDE_CODE_POINTS = 65_536;
export const MAX_WORKING_CODE_POINTS = 16_384;
export const MAX_QUESTION_CODE_POINTS = 1_024;
export const MAX_LABEL_CODE_POINTS = 128;
export const DEFAULT_HISTORY_LIMIT = 64;
export const MAX_HISTORY_LIMIT = 128;
export const MAX_INSPECT_VIEWS = 16;
export const MAX_PIXEL_VIEWS = 64;
export const MAX_PIXEL_SAMPLES = 4_096;

export type ToolName =
	| "play"
	| "inspect"
	| "read_pixels"
	| "history"
	| "read_guide"
	| "write_guide"
	| "read_working"
	| "write_working"
	| "save_compact_checkpoint";

export interface ToolInvocation extends Record<string, JsonValue> {
	schema: typeof TOOL_SCHEMA;
	invocationId: string;
	name: ToolName;
	args: Record<string, JsonValue>;
}

export interface ToolError extends Record<string, JsonValue> {
	code:
		| "invalid_request"
		| "not_found"
		| "anchor_conflict"
		| "version_conflict"
		| "observation_required"
		| "checkpoint_in_progress"
		| "terminal"
		| "storage_failure";
	message: string;
}

export interface ToolResult extends Record<string, JsonValue> {
	schema: typeof RESULT_SCHEMA;
	invocationId: string;
	name: ToolName;
	ok: boolean;
	result?: Record<string, JsonValue>;
	error?: ToolError;
}

export interface ToolAction extends Record<string, JsonValue> {
	name: "RESET" | "ACTION1" | "ACTION2" | "ACTION3" | "ACTION4" | "ACTION5" | "ACTION6" | "ACTION7";
	data: Record<string, JsonValue>;
}

export interface ToolPlayResult extends Record<string, JsonValue> {
	turn: number;
	attempt: number;
	level: number;
	state: "NOT_PLAYED" | "NOT_FINISHED" | "GAME_OVER" | "WIN";
	levelsCompleted: number;
	winLevels: number;
	availableActions: string[];
	frameCount: number;
	visualRef: string;
	observationDigest: string;
}

export interface ToolKnowledge extends Record<string, JsonValue> {
	kind: "guide" | "working";
	content: string;
	version: number;
	anchor: string;
	contentDigest: string;
	invocationId: string | null;
}

export interface ToolCheckpoint extends Record<string, JsonValue> {
	checkpointId: string;
	anchor: string;
	guideVersion: number;
	workingVersion: number;
	commitDigest: string;
}

export interface ToolDomainRecord extends Record<string, JsonValue> {
	recordType: string;
	payload: Record<string, JsonValue>;
	sequence: number;
}

/** JSON logical result 与顺序对应的 image content 分离，避免把 RGB bytes 写进 JSON。 */
export interface ToolExecution {
	envelope: ToolResult;
	images: readonly Visual[];
}

export interface ToolFrame {
	turn: number;
	frame: number;
	visualRef: string;
	visual: Visual;
}

export interface ToolPlayPort {
	play(input: {
		invocationId: string;
		action: ToolAction;
		retryState: string | null;
	}): Promise<{ result: ToolPlayResult; image: Visual }>;
}

export interface ToolEvidencePort {
	readDomain(): Promise<readonly ToolDomainRecord[]>;
	readFrame(turn: number, frame: number | null): Promise<ToolFrame>;
}

export interface ToolKnowledgePort {
	read(kind: "guide" | "working"): Promise<ToolKnowledge | null>;
	replace(input: {
		kind: "guide" | "working";
		content: string;
		invocationId: string;
		expectedVersion: number;
		anchor: string;
	}): Promise<ToolKnowledge>;
	saveCheckpoint(input: {
		invocationId: string;
		guide: string | null;
		workingMemory: string;
		anchor: string;
	}): Promise<ToolCheckpoint>;
	checkpointRequested(): Promise<boolean>;
	boundaryPending(): Promise<boolean>;
	synchronizeLevelArchive(): Promise<void>;
}

export interface ToolRuntimePorts {
	play: ToolPlayPort;
	evidence: ToolEvidencePort;
	knowledge: ToolKnowledgePort;
	digest(value: JsonValue): string;
	anchor(): string;
	isTerminated(): boolean;
}

export class ModelToolError extends Error {
	readonly code: ToolError["code"];

	constructor(code: ToolError["code"], message: string) {
		super(message);
		this.code = code;
	}
}

/** 知识版本/anchor 冲突是可观察的 safe replay 拒绝，而不是未知存储故障。 */
export class KnowledgeConflictError extends ModelToolError {
	constructor(message: string) {
		super("version_conflict", message);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = [],
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of required) if (!(key in value)) throw new ModelToolError("invalid_request", `missing field ${key}`);
	for (const key of Object.keys(value))
		if (!allowed.has(key)) throw new ModelToolError("invalid_request", `unknown field ${key}`);
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new ModelToolError("invalid_request", `${label} must be non-empty`);
	return value;
}

function codePointLength(value: string): number {
	return [...value].length;
}

function boundedString(value: unknown, label: string, maximum: number, allowEmpty = false): string {
	if (typeof value !== "string" || (!allowEmpty && value.length === 0))
		throw new ModelToolError("invalid_request", `${label} must be ${allowEmpty ? "a string" : "non-empty"}`);
	if (codePointLength(value) > maximum)
		throw new ModelToolError("invalid_request", `${label} exceeds ${maximum} code points`);
	return value;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
		throw new ModelToolError("invalid_request", `${label} must be an integer >= ${minimum}`);
	return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!isRecord(value)) throw new ModelToolError("invalid_request", `${label} must be an object`);
	return value;
}

function region(value: unknown): VisualRegion {
	const source = object(value, "region");
	exactKeys(source, ["x", "y", "width", "height"]);
	const x = safeInteger(source.x, "region.x");
	const y = safeInteger(source.y, "region.y");
	const width = safeInteger(source.width, "region.width", 1);
	const height = safeInteger(source.height, "region.height", 1);
	if (x + width > 1024 || y + height > 1024)
		throw new ModelToolError("invalid_request", "region is outside 1024x1024");
	return { x, y, width, height };
}

function toolName(value: unknown): ToolName {
	if (
		value !== "play" &&
		value !== "inspect" &&
		value !== "read_pixels" &&
		value !== "history" &&
		value !== "read_guide" &&
		value !== "write_guide" &&
		value !== "read_working" &&
		value !== "write_working" &&
		value !== "save_compact_checkpoint"
	)
		throw new ModelToolError("invalid_request", "unknown tool name");
	return value;
}

function parseInvocation(value: unknown): ToolInvocation {
	const source = object(value, "tool invocation");
	exactKeys(source, ["schema", "invocationId", "name", "args"]);
	if (source.schema !== TOOL_SCHEMA) throw new ModelToolError("invalid_request", "tool schema is invalid");
	return {
		schema: TOOL_SCHEMA,
		invocationId: nonEmptyString(source.invocationId, "invocationId"),
		name: toolName(source.name),
		args: object(source.args, "args") as Record<string, JsonValue>,
	};
}

function resultOk(invocation: ToolInvocation, result: Record<string, JsonValue>): ToolResult {
	return { schema: RESULT_SCHEMA, invocationId: invocation.invocationId, name: invocation.name, ok: true, result };
}

function resultError(invocation: ToolInvocation, error: unknown): ToolResult {
	const normalized = error instanceof ModelToolError ? error : new ModelToolError("storage_failure", String(error));
	return {
		schema: RESULT_SCHEMA,
		invocationId: invocation.invocationId,
		name: invocation.name,
		ok: false,
		error: { code: normalized.code, message: normalized.message },
	};
}

function rgbKey(rgb: Rgb): string {
	return `${rgb[0]},${rgb[1]},${rgb[2]}`;
}

function actionFromArgs(args: Record<string, unknown>): { action: ToolAction; retryState: string | null } {
	exactKeys(args, ["action"], ["x", "y", "retry_state"]);
	const name = args.action;
	if (
		name !== "RESET" &&
		name !== "ACTION1" &&
		name !== "ACTION2" &&
		name !== "ACTION3" &&
		name !== "ACTION4" &&
		name !== "ACTION5" &&
		name !== "ACTION6" &&
		name !== "ACTION7"
	)
		throw new ModelToolError("invalid_request", "action is invalid");
	if (name === "ACTION6") {
		exactKeys(args, ["action", "x", "y"]);
		const x = safeInteger(args.x, "x");
		const y = safeInteger(args.y, "y");
		if (x > 1023 || y > 1023) throw new ModelToolError("invalid_request", "ACTION6 coordinates must be 0..1023");
		return { action: { name, data: mapAction6Point(x, y) }, retryState: null };
	}
	if (name === "RESET") {
		exactKeys(args, ["action", "retry_state"]);
		return {
			action: { name, data: {} },
			retryState: boundedString(args.retry_state, "retry_state", MAX_WORKING_CODE_POINTS),
		};
	}
	if ("x" in args || "y" in args || "retry_state" in args)
		throw new ModelToolError("invalid_request", "extra Action fields are not allowed");
	return { action: { name, data: {} }, retryState: null };
}

function parseQuestion(value: unknown): string {
	return boundedString(value, "question", MAX_QUESTION_CODE_POINTS);
}

/** provider-neutral 的单 invocation 工具执行器；它不启动 Pi，也不执行网络操作。 */
export class ModelToolExecutor {
	constructor(private readonly ports: ToolRuntimePorts) {}

	async execute(value: unknown): Promise<ToolExecution> {
		let invocation: ToolInvocation;
		try {
			invocation = parseInvocation(value);
		} catch (error) {
			const fallback: ToolInvocation = {
				schema: TOOL_SCHEMA,
				invocationId: "invalid",
				name: "history",
				args: {},
			};
			return { envelope: resultError(fallback, error), images: [] };
		}
		try {
			if ((await this.ports.knowledge.checkpointRequested()) && invocation.name !== "save_compact_checkpoint")
				throw new ModelToolError("checkpoint_in_progress", "checkpoint commit is in progress");
			if (invocation.name === "play" && (await this.ports.knowledge.boundaryPending()))
				throw new ModelToolError("observation_required", "Context Boundary must be delivered before play");
			if (
				(invocation.name === "play" ||
					invocation.name === "write_guide" ||
					invocation.name === "write_working" ||
					invocation.name === "save_compact_checkpoint") &&
				this.ports.isTerminated()
			)
				throw new ModelToolError("terminal", "Run is terminated");
			const output = await this.dispatch(invocation);
			return { envelope: resultOk(invocation, output.logical), images: output.images };
		} catch (error) {
			return { envelope: resultError(invocation, error), images: [] };
		}
	}

	private async dispatch(
		invocation: ToolInvocation,
	): Promise<{ logical: Record<string, JsonValue>; images: Visual[] }> {
		switch (invocation.name) {
			case "play":
				return this.play(invocation);
			case "inspect":
				return this.inspect(invocation);
			case "read_pixels":
				return { logical: await this.readPixels(invocation), images: [] };
			case "history":
				return { logical: await this.history(invocation), images: [] };
			case "read_guide":
				return { logical: await this.readKnowledge(invocation, "guide"), images: [] };
			case "write_guide":
				return { logical: await this.writeKnowledge(invocation, "guide"), images: [] };
			case "read_working":
				return { logical: await this.readKnowledge(invocation, "working"), images: [] };
			case "write_working":
				return { logical: await this.writeKnowledge(invocation, "working"), images: [] };
			case "save_compact_checkpoint":
				return { logical: await this.checkpoint(invocation), images: [] };
		}
	}

	private async play(invocation: ToolInvocation): Promise<{ logical: Record<string, JsonValue>; images: Visual[] }> {
		const parsed = actionFromArgs(invocation.args);
		const output = await this.ports.play.play({
			invocationId: invocation.invocationId,
			action: parsed.action,
			retryState: parsed.retryState,
		});
		await this.ports.knowledge.synchronizeLevelArchive();
		return { logical: output.result, images: [output.image] };
	}

	private async inspect(
		invocation: ToolInvocation,
	): Promise<{ logical: Record<string, JsonValue>; images: Visual[] }> {
		const args = invocation.args;
		exactKeys(args, ["question", "views"]);
		const question = parseQuestion(args.question);
		if (!Array.isArray(args.views) || args.views.length < 1 || args.views.length > MAX_INSPECT_VIEWS)
			throw new ModelToolError("invalid_request", "inspect views must contain 1..16 items");
		const views = [] as Record<string, JsonValue>[];
		const images: Visual[] = [];
		for (const value of args.views) {
			const view = object(value, "inspect view");
			exactKeys(view, ["label", "turn"], ["frame", "region"]);
			const label = boundedString(view.label, "view.label", MAX_LABEL_CODE_POINTS);
			const turn = safeInteger(view.turn, "view.turn");
			const frame = view.frame === undefined ? null : safeInteger(view.frame, "view.frame");
			const source = await this.ports.evidence.readFrame(turn, frame);
			const visual =
				view.region === undefined ? source.visual : renderInspectionRegion(source.visual, region(view.region));
			views.push({ label, turn: source.turn, frame: source.frame, visualRef: source.visualRef });
			images.push(visual);
		}
		return { logical: { question, views }, images };
	}

	private async readPixels(invocation: ToolInvocation): Promise<Record<string, JsonValue>> {
		const args = invocation.args;
		exactKeys(args, ["question", "views"]);
		const question = parseQuestion(args.question);
		if (!Array.isArray(args.views) || args.views.length < 1 || args.views.length > MAX_PIXEL_VIEWS)
			throw new ModelToolError("invalid_request", "read_pixels views must contain 1..64 items");
		// 每个 view 的局部索引统一重编码为本次请求共享的 palette。
		const shared = await this.sharedPixels(args.views as unknown[]);
		return { question, palette: shared.palette.map((rgb) => [...rgb]), views: shared.views };
	}

	private async sharedPixels(
		values: readonly unknown[],
	): Promise<{ palette: Rgb[]; views: Record<string, JsonValue>[] }> {
		const palette: Rgb[] = [];
		const indexes = new Map<string, number>();
		const views: Record<string, JsonValue>[] = [];
		let total = 0;
		for (const value of values) {
			const source = object(value, "pixel view");
			exactKeys(source, ["label", "turn", "region", "rows", "columns"], ["frame"]);
			boundedString(source.label, "view.label", MAX_LABEL_CODE_POINTS);
			const selectedRegion = region(source.region);
			const rows = safeInteger(source.rows, "view.rows", 1);
			const columns = safeInteger(source.columns, "view.columns", 1);
			if (rows > 1024 || columns > 1024)
				throw new ModelToolError("invalid_request", "sample dimensions exceed 1024");
			total += rows * columns;
			if (total > MAX_PIXEL_SAMPLES)
				throw new ModelToolError("invalid_request", "read_pixels exceeds 4096 total samples");
			const selectedFrame = source.frame === undefined ? null : safeInteger(source.frame, "view.frame");
			const frame = await this.ports.evidence.readFrame(safeInteger(source.turn, "view.turn"), selectedFrame);
			const samples = sampleVisualRegion(frame.visual, selectedRegion, rows, columns);
			const rowsOut = samples.map((row) =>
				row
					.map((rgb) => {
						const key = rgbKey(rgb);
						let index = indexes.get(key);
						if (index === undefined) {
							index = palette.length;
							indexes.set(key, index);
							palette.push(rgb);
						}
						return index.toString(16);
					})
					.join(""),
			);
			views.push({
				label: boundedString(source.label, "view.label", MAX_LABEL_CODE_POINTS),
				turn: frame.turn,
				frame: frame.frame,
				rows: rowsOut,
			});
		}
		return { palette, views };
	}

	private async history(invocation: ToolInvocation): Promise<Record<string, JsonValue>> {
		const args = invocation.args;
		exactKeys(args, ["view"], ["start_turn", "end_turn", "limit"]);
		if (args.view !== "attempts" && args.view !== "events")
			throw new ModelToolError("invalid_request", "history.view must be attempts or events");
		const start = args.start_turn === undefined ? 0 : safeInteger(args.start_turn, "start_turn");
		const end = args.end_turn === undefined ? Number.MAX_SAFE_INTEGER : safeInteger(args.end_turn, "end_turn");
		if (end < start) throw new ModelToolError("invalid_request", "end_turn must be >= start_turn");
		const limit = args.limit === undefined ? DEFAULT_HISTORY_LIMIT : safeInteger(args.limit, "limit", 1);
		if (limit > MAX_HISTORY_LIMIT) throw new ModelToolError("invalid_request", "history.limit must be 1..128");
		const records = await this.ports.evidence.readDomain();
		// 未提交的 intent、receipt、模型 transcript 都不能冒充已发生的游戏事件。
		const candidates = records.filter(
			(entry) =>
				entry.recordType === "turn.commit" &&
				typeof entry.payload.turn === "number" &&
				entry.payload.turn >= start &&
				entry.payload.turn <= end,
		);
		const selected = candidates.slice(0, limit);
		const firstTurn = selected[0]?.payload.turn;
		const lastTurn = selected.at(-1)?.payload.turn;
		const actualStartTurn = typeof firstTurn === "number" ? firstTurn : null;
		const actualEndTurn = typeof lastTurn === "number" ? lastTurn : null;
		if (args.view === "events") {
			const events = selected.map((entry) => ({
				turn: entry.payload.turn ?? null,
				actionId: entry.payload.actionId ?? null,
				observation: entry.payload.observation ?? null,
				observationDigest: entry.payload.observationDigest ?? null,
				level: entry.payload.level ?? null,
				attempt: entry.payload.attempt ?? null,
				attemptStatus: entry.payload.attemptStatus ?? null,
			}));
			return {
				view: "events",
				events,
				actualStartTurn,
				actualEndTurn,
				truncated: selected.length < candidates.length,
			};
		}
		const attempts = new Map<string, Record<string, JsonValue>>();
		for (const entry of selected) {
			const attempt = entry.payload.attempt;
			if (typeof attempt !== "number") continue;
			const key = `${entry.payload.level ?? 1}:${attempt}`;
			if (!attempts.has(key))
				attempts.set(key, {
					level: entry.payload.level ?? 1,
					attempt,
					firstTurn: entry.payload.turn ?? 0,
					lastTurn: entry.payload.turn ?? 0,
					status: "active",
				});
			const summary = attempts.get(key);
			if (summary !== undefined) {
				summary.lastTurn = entry.payload.turn ?? summary.lastTurn ?? 0;
				if (entry.payload.attemptStatus === "ended") summary.status = "ended";
			}
		}
		return {
			view: "attempts",
			attempts: [...attempts.values()],
			actualStartTurn,
			actualEndTurn,
			truncated: selected.length < candidates.length,
		};
	}

	private async readKnowledge(
		invocation: ToolInvocation,
		kind: "guide" | "working",
	): Promise<Record<string, JsonValue>> {
		exactKeys(invocation.args, []);
		const current = await this.ports.knowledge.read(kind);
		return (
			current ?? {
				kind,
				content: "",
				version: 0,
				anchor: this.ports.anchor(),
				contentDigest: this.ports.digest(""),
				invocationId: null,
			}
		);
	}

	private async writeKnowledge(
		invocation: ToolInvocation,
		kind: "guide" | "working",
	): Promise<Record<string, JsonValue>> {
		exactKeys(invocation.args, ["content"]);
		const content = boundedString(
			invocation.args.content,
			kind === "guide" ? "content" : "content",
			kind === "guide" ? MAX_GUIDE_CODE_POINTS : MAX_WORKING_CODE_POINTS,
		);
		const current = await this.ports.knowledge.read(kind);
		const written = await this.ports.knowledge.replace({
			kind,
			content,
			invocationId: invocation.invocationId,
			expectedVersion: current?.version ?? 0,
			anchor: this.ports.anchor(),
		});
		return written;
	}

	private checkpoint(invocation: ToolInvocation): Promise<Record<string, JsonValue>> {
		exactKeys(invocation.args, ["guide", "working_memory"]);
		const guideValue = invocation.args.guide;
		if (guideValue !== null && typeof guideValue !== "string")
			throw new ModelToolError("invalid_request", "guide must be string or null");
		const guide = guideValue === null ? null : boundedString(guideValue, "guide", MAX_GUIDE_CODE_POINTS);
		const workingMemory = boundedString(invocation.args.working_memory, "working_memory", MAX_WORKING_CODE_POINTS);
		return this.ports.knowledge.saveCheckpoint({
			guide,
			workingMemory,
			invocationId: invocation.invocationId,
			anchor: this.ports.anchor(),
		});
	}
}
