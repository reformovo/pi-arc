/**
 * VISTA Codex 模型可见提示词的 provider-neutral 基线。
 *
 * 英文正文有意沿用 VISTA 已验证的措辞；中文注释说明 pi-arc 必须偏离的
 * 契约。Pi adapter 只负责传递这些文本和 JSON Schema，不得临时改写策略。
 */

import type { JsonValue } from "../protocol/canonical-json.js";
import type { ToolName } from "./model-tools.js";

/** 只组合已加载的原文与补充要求；文件 I/O 属于 composition 层。 */
export function composeModelSystemPrompt(vistaPrompt: string, addendum: string): string {
	if (vistaPrompt.trim().length === 0 || addendum.trim().length === 0) throw new Error("model prompt source is empty");
	return `${vistaPrompt.trimEnd()}\n\n${addendum.trimEnd()}`;
}

/** VISTA Codex 的任务目标与 checkpoint 指令，保持原文以便离线回归比较。 */
export const TASK_OBJECTIVE = "Complete the game with as few game actions as possible.";
export const RECOVERY_TASK_OBJECTIVE = "Continue the game with as few game actions as possible.";
export const CHECKPOINT_PROMPT =
	'<codex_internal_context source="compact_checkpoint">\nCall save_compact_checkpoint now as your first and only action, then end this turn.\n</codex_internal_context>';
export const NONTERMINAL_CONTINUATION_PROMPT =
	"The environment is still active. Context limits are handled automatically. Continue.";

/** 与 VISTA 初始任务消息保持相同段落顺序；Observation 必须由 controller 提供。 */
export function buildInitialTaskPrompt(currentObservation: JsonValue): string {
	return ["Current observation:", JSON.stringify(currentObservation), "", TASK_OBJECTIVE].join("\n");
}

/** RESET/checkpoint 的恢复消息沿用 VISTA 的 Environment / notes 分栏。 */
export function buildBoundaryRecoveryPrompt(input: {
	currentObservation: JsonValue;
	lastActionResult: JsonValue | null;
	currentLevelHistory: JsonValue;
	guide: JsonValue;
	workingMemory: JsonValue;
}): string {
	return [
		"Environment record:",
		JSON.stringify({
			current_observation: input.currentObservation,
			last_action_result: input.lastActionResult,
			current_level_history: input.currentLevelHistory,
		}),
		"",
		"Agent-authored notes:",
		JSON.stringify({ guide: input.guide, working_memory: input.workingMemory }),
		"",
		RECOVERY_TASK_OBJECTIVE,
	].join("\n");
}

export interface ModelToolDefinition {
	name: ToolName;
	description: string;
	inputSchema: Record<string, JsonValue>;
	annotations: {
		readOnlyHint: boolean;
		destructiveHint: false;
		idempotentHint: boolean;
		openWorldHint: false;
	};
}

const regionSchema: Record<string, JsonValue> = {
	type: "object",
	additionalProperties: false,
	required: ["x", "y", "width", "height"],
	properties: {
		x: { type: "integer", minimum: 0, maximum: 1023 },
		y: { type: "integer", minimum: 0, maximum: 1023 },
		width: { type: "integer", minimum: 1, maximum: 1024 },
		height: { type: "integer", minimum: 1, maximum: 1024 },
	},
};

function viewSchema(pixel: boolean): Record<string, JsonValue> {
	return {
		type: "object",
		additionalProperties: false,
		required: pixel ? ["label", "turn", "region", "rows", "columns"] : ["label", "turn"],
		properties: {
			label: { type: "string", minLength: 1, maxLength: 128 },
			turn: { type: "integer", minimum: 0 },
			frame: {
				type: "integer",
				minimum: 0,
				description: "Exact archived frame; omit for the final frame.",
			},
			region: regionSchema,
			...(pixel
				? {
						rows: { type: "integer", minimum: 1, maximum: 1024 },
						columns: { type: "integer", minimum: 1, maximum: 1024 },
					}
				: {}),
		},
	};
}

function definition(
	name: ToolName,
	description: string,
	properties: Record<string, JsonValue>,
	required: readonly string[],
	readOnly: boolean,
	idempotent: boolean,
): ModelToolDefinition {
	return {
		name,
		description,
		inputSchema: { type: "object", additionalProperties: false, required: [...required], properties },
		annotations: {
			readOnlyHint: readOnly,
			destructiveHint: false,
			idempotentHint: idempotent,
			openWorldHint: false,
		},
	};
}

/** 顺序、描述与 annotation 以 VISTA Codex `build_tools()` 为基线。 */
export const MODEL_TOOL_DEFINITIONS: readonly ModelToolDefinition[] = [
	definition(
		"play",
		"Execute exactly one game action. Each executed play call counts as one game action. The result contains the resulting final visual, the number of archived frames for the action, and the actions available afterward. The player observes this result before another action can execute. Use only currently available actions. RESET restarts the current level after GAME_OVER. ACTION1 through ACTION4 are game-dependent simple actions usually associated with up, down, left, and right. ACTION5 is a game-dependent simple action, usually an interaction such as select, rotate, attach, detach, execute, etc. ACTION6 is a coordinate action. ACTION7 is Undo. UI bindings: ACTION1=W/Up Arrow, ACTION2=S/Down Arrow, ACTION3=A/Left Arrow, ACTION4=D/Right Arrow, ACTION5=Space/F, ACTION6=mouse click, and ACTION7=Ctrl/Cmd+Z. For ACTION6, always provide x and y in the standard 1024x1024 coordinate system; x increases right and y increases down. For RESET, include the smallest sufficient continuation state for the next attempt in retry_state; it replaces WORKING.md.",
		{
			action: {
				type: "string",
				enum: ["RESET", "ACTION1", "ACTION2", "ACTION3", "ACTION4", "ACTION5", "ACTION6", "ACTION7"],
			},
			x: { type: "integer", minimum: 0, maximum: 1023 },
			y: { type: "integer", minimum: 0, maximum: 1023 },
			retry_state: {
				type: "string",
				minLength: 1,
				maxLength: 16_384,
				description:
					"For RESET, the smallest sufficient continuation state for the next attempt. It replaces WORKING.md.",
			},
		},
		["action"],
		false,
		false,
	),
	definition(
		"inspect",
		"Inspect one or more supplied visuals without changing the current game state. Each view selects an archived turn; omit frame to use that turn's final frame. Omit region to see the full visual, or select a rectangular region in the same standard 1024x1024 coordinates used by ACTION6. A selected region is cropped exactly from that visual and enlarged proportionally to fit within 1024x1024 without smoothing. State the visual question these views should answer and give each view a short label. Include the evidence needed to answer that question in the same request. The selected views are returned in request order; your question and labels remain in the inspect call.",
		{
			question: { type: "string", minLength: 1, maxLength: 1024 },
			views: { type: "array", minItems: 1, maxItems: 16, items: viewSchema(false) },
		},
		["question", "views"],
		true,
		true,
	),
	definition(
		"read_pixels",
		"Read exact discrete color samples from one or more supplied visuals without changing the game state. Each view divides its selected rectangular region into equal rows and columns and samples the center pixel of every part from the archived supplied PNG. The result contains one RGB symbol palette and one compact row string per sampled row for each view in request order. At most 64 views may be selected, with at most 4096 samples total per call. This tool only measures pixels; it does not align, transform, compare, or interpret them. State the visual question and give each view a short label; those remain in this call.",
		{
			question: { type: "string", minLength: 1, maxLength: 1024 },
			views: { type: "array", minItems: 1, maxItems: 64, items: viewSchema(true) },
		},
		["question", "views"],
		true,
		true,
	),
	definition(
		"history",
		"Read objective action and environment-result records from this run without changing the game. `attempts` summarizes RESET-to-GAME_OVER attempts across this run's levels. `events` returns exact public action/result records by turn; use start_turn, end_turn, and limit to select a range.",
		{
			view: { type: "string", enum: ["attempts", "events"] },
			start_turn: { type: "integer", minimum: 0 },
			end_turn: { type: "integer", minimum: 0 },
			limit: { type: "integer", minimum: 1, maximum: 128, default: 64 },
		},
		["view"],
		true,
		true,
	),
	definition("read_guide", "Read `GUIDE.md`.", {}, [], true, true),
	definition(
		"write_guide",
		"Write the complete contents of `GUIDE.md`, replacing its previous contents.",
		{ content: { type: "string", minLength: 1, maxLength: 65_536 } },
		["content"],
		false,
		true,
	),
	definition("read_working", "Read the agent-authored temporary state for the current level.", {}, [], true, true),
	definition(
		"write_working",
		"Replace the agent-authored temporary state for the current level. It persists across RESET via retry_state and is cleared when level progress advances.",
		{ content: { type: "string", minLength: 1, maxLength: 16_384 } },
		["content"],
		false,
		true,
	),
	definition(
		"save_compact_checkpoint",
		"Atomically save the pre-compaction game checkpoint. Set guide to a complete replacement GUIDE.md only when the durable game model materially changed; otherwise set it to null. Store in working_memory only the current continuation state that cannot be recovered from GUIDE.md and the current visual: the active plan, its next visible prediction, unresolved contradictions, and any necessary turn/frame references.",
		{
			guide: { type: ["string", "null"], minLength: 1, maxLength: 65_536 },
			working_memory: { type: "string", minLength: 1, maxLength: 16_384 },
		},
		["guide", "working_memory"],
		false,
		true,
	),
];
