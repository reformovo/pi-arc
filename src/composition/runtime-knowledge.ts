/**
 * 将已提交 ARC Evidence 和 GUIDE/WORKING 投影组成模型恢复消息。
 *
 * 消息只引用 Turn commit 与知识快照，不从 Pi transcript 反推 Environment；
 * RESET/checkpoint boundary 的确认由 runtime 在 Pi operation 接纳后调用。
 */

import type { ArtifactStore, DomainRecord } from "../adapters/artifact-store.js";
import { buildBoundaryRecoveryPrompt, CHECKPOINT_PROMPT } from "../application/model-prompts.js";
import { canonicalJson, type JsonValue } from "../protocol/canonical-json.js";
import type { KnowledgeStore } from "./knowledge-store.js";
import type { RuntimeAuthority } from "./pi-runtime.js";

/** 原生 intent/receipt 精确校验后才投影；恢复坐标统一为 1024 bin 中心，不冒充原模型输入或改写 Evidence。 */
function modelFacingAction(action: JsonValue): JsonValue {
	if (action === null || typeof action !== "object" || Array.isArray(action) || action.name !== "ACTION6")
		return action;
	const data = action.data;
	if (data === null || typeof data !== "object" || Array.isArray(data))
		throw new Error("recovery ACTION6 native coordinates must be integers in 0..63");
	const { x, y } = data;
	if (
		typeof x !== "number" ||
		typeof y !== "number" ||
		!Number.isInteger(x) ||
		!Number.isInteger(y) ||
		x < 0 ||
		x > 63 ||
		y < 0 ||
		y > 63
	)
		throw new Error("recovery ACTION6 native coordinates must be integers in 0..63");
	return {
		...action,
		data: { ...data, x: x * 16 + 8, y: y * 16 + 8 },
		coordinateSpace: "visual_1024",
		coordinateRepresentation: "canonical_replay_equivalent",
	};
}

const RECOVERY_COORDINATE_DIRECTIVE =
	"Recovery coordinate rule: ACTION6 action.data.x/y in last_action_result and current_level_history use visual_1024 coordinates (0..1023), the same coordinates accepted by play. These are canonical bin centers derived from committed native coordinates (native * 16 + 8), not the original model input; they map to the exact same native cell. Use them directly as play x/y; do not divide by 16. Recovery describes already committed actions, not instructions to replay them.";

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
		// A pending intent is not a result. Resolve actions only through a preceding
		// intent and the receipt referenced by the committed Turn, never transcript.
		const committedAction = (commit: DomainRecord): JsonValue => {
			if (commit.payload.actionId === null && commit.payload.turn === 0) return null;
			const intent = records.find(
				(record) =>
					record.sequence < commit.sequence &&
					record.recordType === "action.intent" &&
					record.payload.actionId === commit.payload.actionId,
			);
			if (
				intent === undefined ||
				typeof commit.payload.receiptDigest !== "string" ||
				intent.payload.action === null ||
				typeof intent.payload.action !== "object"
			)
				throw new Error("recovery Action intent or receipt digest missing for committed Turn");
			const receipt = records.find(
				(record) =>
					record.sequence > intent.sequence &&
					record.sequence < commit.sequence &&
					record.recordType === "environment.receipt" &&
					record.payload.actionId === commit.payload.actionId &&
					record.payload.receiptDigest === commit.payload.receiptDigest,
			);
			if (
				receipt === undefined ||
				receipt.payload.status !== "complete" ||
				receipt.payload.environmentInstanceId !== intent.payload.environmentInstanceId ||
				receipt.payload.baseTurn !== intent.payload.baseTurn ||
				receipt.payload.baseObservationDigest !== intent.payload.baseObservationDigest ||
				receipt.payload.turn !== commit.payload.turn ||
				canonicalJson(receipt.payload.action ?? null) !== canonicalJson(intent.payload.action) ||
				canonicalJson(receipt.payload.observation ?? null) !== canonicalJson(commit.payload.observation ?? null)
			)
				throw new Error("recovery Action/receipt/Turn commit mismatch");
			return modelFacingAction(intent.payload.action);
		};
		const history: JsonValue = records
			.filter(
				(record) =>
					record.recordType === "turn.commit" &&
					record.payload.level === authority.turn.level &&
					typeof record.payload.turn === "number" &&
					record.payload.turn <= authority.turn.turn,
			)
			// Full history remains available through history; recovery is a bounded seed.
			.slice(-128)
			.map((record) => ({
				turn: record.payload.turn ?? null,
				level: record.payload.level ?? null,
				attempt: record.payload.attempt ?? null,
				attemptStatus: record.payload.attemptStatus ?? null,
				actionId: record.payload.actionId ?? null,
				action: committedAction(record),
				observation: record.payload.observation ?? null,
				observationDigest: record.payload.observationDigest ?? null,
			}));
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
