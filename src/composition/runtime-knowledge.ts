/**
 * 将已提交 ARC Evidence 和 GUIDE/WORKING 投影组成模型恢复消息。
 *
 * 消息只引用 Turn commit 与知识快照，不从 Pi transcript 反推 Environment；
 * RESET/checkpoint boundary 的确认由 runtime 在 Pi operation 接纳后调用。
 */

import type { ArtifactStore, DomainRecord } from "../adapters/artifact-store.js";
import { committedActionProjection } from "../application/committed-action-projection.js";
import { buildBoundaryRecoveryPrompt, CHECKPOINT_PROMPT } from "../application/model-prompts.js";
import { canonicalJson, type JsonValue } from "../protocol/canonical-json.js";
import type { KnowledgeStore } from "./knowledge-store.js";
import type { RuntimeAuthority } from "./pi-runtime.js";

const RECOVERY_COORDINATE_DIRECTIVE =
	"Recovery coordinate rule: ACTION6 action.data.x/y in last_action_result use visual_1024 coordinates (0..1023), the same coordinates accepted by play. These are canonical bin centers derived from committed native coordinates (native * 16 + 8), not the original model input; they map to the exact same native cell. Use them directly as play x/y; do not divide by 16. Recovery describes already committed actions, not instructions to replay them.";

export class RuntimeKnowledgeBridge {
	constructor(
		private readonly artifacts: ArtifactStore,
		private readonly knowledge: KnowledgeStore,
	) {}

	/** 读取投影会验证所有被引用 snapshot 的内容摘要与 commit marker。 */
	async validate(_authority: RuntimeAuthority): Promise<void> {
		await Promise.all([this.knowledge.read("guide"), this.knowledge.read("working")]);
		await this.knowledge.boundaryPending();
		await this.knowledge.checkpointRequested();
	}

	async recoveryEnvelope(authority: RuntimeAuthority): Promise<string> {
		if (await this.knowledge.checkpointRequested()) return CHECKPOINT_PROMPT;
		const [guide, working] = await Promise.all([this.knowledge.read("guide"), this.knowledge.read("working")]);
		return this.buildEnvelope(authority, guide?.content ?? "", working?.content ?? "");
	}

	private async buildEnvelope(authority: RuntimeAuthority, guide: string, working: string): Promise<string> {
		const records = await this.artifacts.readDomain();
		const committedAction = committedActionProjection(records);
		const levelRecords = records.filter(
			(record) =>
				record.recordType === "turn.commit" &&
				record.payload.level === authority.turn.level &&
				typeof record.payload.turn === "number" &&
				record.payload.turn <= authority.turn.turn,
		);
		const firstLevelRecord = levelRecords[0];
		if (firstLevelRecord === undefined) throw new Error("recovery Level entry missing");
		const firstTurn = firstLevelRecord.payload.turn;
		const attempts: Array<JsonValue> = [];
		{
			const firstAttempt = firstLevelRecord.payload.attempt;
			if (firstAttempt !== 1 || typeof firstTurn !== "number")
				throw new Error("recovery Level entry Attempt missing");
			if (
				firstTurn > 0 &&
				!records.some(
					(record) =>
						record.recordType === "turn.commit" &&
						record.payload.turn === firstTurn - 1 &&
						record.payload.level !== authority.turn.level,
				)
			)
				throw new Error("recovery Level entry anchor missing");
			committedAction(firstLevelRecord);
			const stateOf = (record: DomainRecord): string => {
				const observation = record.payload.observation;
				if (
					observation === null ||
					typeof observation !== "object" ||
					Array.isArray(observation) ||
					typeof observation.state !== "string"
				)
					throw new Error("recovery Observation state missing");
				return observation.state;
			};
			let current: {
				attempt: number;
				start: "level_entry" | "reset";
				start_turn: number;
				outcome: string;
				game_actions: number;
				end_turn: number;
			} = {
				attempt: firstAttempt,
				start: "level_entry",
				start_turn: firstTurn,
				outcome: stateOf(firstLevelRecord),
				game_actions: 0,
				end_turn: firstTurn,
			};
			for (const record of levelRecords.slice(1)) {
				const turn = record.payload.turn;
				const attempt = record.payload.attempt;
				if (typeof turn !== "number" || typeof attempt !== "number" || turn !== current.end_turn + 1)
					throw new Error("recovery Attempt record incomplete");
				const action = committedAction(record);
				if (action === null) throw new Error("recovery committed Action missing");
				if (typeof action === "object" && action !== null && !Array.isArray(action) && action.name === "RESET") {
					if (attempt !== current.attempt + 1 || current.outcome !== "GAME_OVER")
						throw new Error("recovery RESET Attempt mismatch");
					attempts.push(current);
					current = {
						attempt,
						start: "reset",
						start_turn: turn,
						outcome: stateOf(record),
						game_actions: 0,
						end_turn: turn,
					};
				} else {
					if (attempt !== current.attempt) throw new Error("recovery Attempt changed without RESET");
					if (current.outcome === "GAME_OVER" || current.outcome === "WIN")
						throw new Error("recovery Action after ended Attempt");
					current = {
						...current,
						game_actions: current.game_actions + 1,
						outcome: stateOf(record),
						end_turn: turn,
					};
				}
			}
			attempts.push(current);
		}
		const history: JsonValue = {
			view: "attempts",
			source: "environment action results",
			level: authority.turn.level,
			level_start_turn: firstTurn,
			progress: {
				completed: authority.turn.observation.levelsCompleted,
				total: authority.turn.observation.winLevels,
			},
			attempts: attempts.slice(-128),
			total_attempts: attempts.length,
			truncated: attempts.length > 128,
		};
		const lastCommit = records.find(
			(record) =>
				record.recordType === "turn.commit" &&
				record.payload.turn === authority.turn.turn &&
				record.payload.actionId === authority.turn.actionId &&
				record.payload.observationDigest === authority.turn.observationDigest &&
				record.payload.level === authority.turn.level &&
				record.payload.attempt === authority.turn.attempt &&
				canonicalJson(record.payload.observation ?? null) === canonicalJson(authority.turn.observation),
		);
		if (lastCommit === undefined) throw new Error("recovery authority does not match a committed Turn");
		const prompt = buildBoundaryRecoveryPrompt({
			currentObservation: authority.turn.observation,
			lastActionResult:
				authority.turn.actionId === null
					? null
					: {
							turn: authority.turn.turn,
							level: lastCommit.payload.level ?? null,
							attempt: lastCommit.payload.attempt ?? null,
							attemptStatus: lastCommit.payload.attemptStatus ?? null,
							actionId: authority.turn.actionId,
							observationDigest: authority.turn.observationDigest,
							action: committedAction(lastCommit),
							observation: authority.turn.observation,
						},
			currentLevelHistory: history,
			guide,
			workingMemory: working,
		});
		return `${prompt}\n\n${RECOVERY_COORDINATE_DIRECTIVE}`;
	}

	/** 返回同一个 boundary ID/prompt；重复调用不得再次 RESET 或写知识。 */
	async prepareBoundary(authority: RuntimeAuthority): Promise<{ boundaryId: string; prompt: string } | null> {
		const boundary = await this.knowledge.deliverBoundary();
		if (boundary === null || !(await this.knowledge.boundaryPending())) return null;
		return {
			boundaryId: boundary.boundaryId,
			prompt: await this.buildEnvelope(authority, boundary.guide, boundary.working),
		};
	}

	acknowledgeBoundary(boundaryId: string): Promise<void> {
		return this.knowledge.acknowledgeBoundary(boundaryId);
	}

	pendingCheckpoint(): Promise<boolean> {
		return this.knowledge.checkpointRequested();
	}
}
