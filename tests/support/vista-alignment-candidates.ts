/** P3 离线候选：只供测试使用，不导入生产，不推断规则或隐藏游戏状态。 */
import type { JsonValue } from "../../src/protocol/canonical-json.js";

export interface ValidatedHistoryEntry {
	turn: number;
	level: number;
	attempt: number;
	action: JsonValue;
	observation: { state: string };
}

/** 输入必须由现有 recovery proof join 验证；不能用 intent 直接生成动作候选。 */
export function candidateHistoryAction(entry: ValidatedHistoryEntry): JsonValue {
	const action = entry.action;
	if (action === null) return null;
	if (typeof action !== "object" || Array.isArray(action)) throw new Error("Invalid projected action");
	const name = action.name;
	if (typeof name !== "string" || !/^(RESET|ACTION[1-7])$/.test(name)) throw new Error("Invalid action name");
	if (name !== "ACTION6") return { name, data: {} };
	const data = action.data;
	if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("Missing visual data");
	const { x, y } = data;
	if (
		typeof x !== "number" ||
		typeof y !== "number" ||
		!Number.isInteger(x) ||
		!Number.isInteger(y) ||
		x < 0 ||
		y < 0 ||
		x > 1023 ||
		y > 1023 ||
		x % 16 !== 8 ||
		y % 16 !== 8 ||
		action.coordinateSpace !== "visual_1024" ||
		action.coordinateRepresentation !== "canonical_replay_equivalent"
	)
		throw new Error("Expected validated visual1024 action");
	return {
		name,
		data: { x, y },
		coordinateSpace: "visual_1024",
		coordinateRepresentation: "canonical_replay_equivalent",
	};
}

/**
 * Candidate recovery shape, not a public tool result. Input is a complete ordered Level
 * sequence from committed evidence, including its entry Turn; do not pass a bounded seed.
 */
export function candidateAttemptSummary(
	entries: readonly ValidatedHistoryEntry[],
	scope: { level: number; levelStartTurn: number },
	limit = 128,
) {
	const { level, levelStartTurn } = scope;
	if (!Number.isInteger(limit) || limit < 1 || limit > 128) throw new Error("Invalid summary limit");
	if (entries.length === 0 || entries.some((entry) => entry.level !== level)) throw new Error("Missing Level scope");
	for (let index = 1; index < entries.length; index++) {
		const previous = entries[index - 1];
		const entry = entries[index];
		if (!previous || !entry || entry.turn !== previous.turn + 1) throw new Error("Incomplete Level sequence");
	}
	const first = entries[0];
	if (!first) throw new Error("Missing entry Turn");
	if (first.attempt !== 1 || first.turn !== levelStartTurn) throw new Error("Missing Level entry anchor");
	const attempts: Array<{
		attempt: number;
		start: "level_entry" | "reset";
		start_turn: number;
		outcome: string;
		game_actions: number;
		end_turn: number;
	}> = [];
	let summary = {
		attempt: first.attempt,
		start: "level_entry" as "level_entry" | "reset",
		start_turn: first.turn,
		outcome: first.observation.state,
		game_actions: 0,
		end_turn: first.turn,
	};
	for (const entry of entries.slice(1)) {
		const action = candidateHistoryAction(entry);
		if (action === null) throw new Error("Missing committed action");
		if (typeof action === "object" && !Array.isArray(action) && action.name === "RESET") {
			if (entry.attempt !== summary.attempt + 1 || summary.outcome !== "GAME_OVER")
				throw new Error("Invalid reset Attempt");
			attempts.push(summary);
			summary = {
				attempt: entry.attempt,
				start: "reset",
				start_turn: entry.turn,
				outcome: entry.observation.state,
				game_actions: 0,
				end_turn: entry.turn,
			};
		} else {
			if (entry.attempt !== summary.attempt) throw new Error("Attempt changed without RESET");
			if (summary.outcome === "GAME_OVER" || summary.outcome === "WIN")
				throw new Error("Action after ended Attempt");
			summary = {
				...summary,
				game_actions: summary.game_actions + 1,
				end_turn: entry.turn,
				outcome: entry.observation.state,
			};
		}
	}
	attempts.push(summary);
	return {
		view: "attempts",
		level,
		level_start_turn: first.turn,
		attempts: attempts.slice(-limit),
		total_attempts: attempts.length,
		truncated: attempts.length > limit,
	};
}
