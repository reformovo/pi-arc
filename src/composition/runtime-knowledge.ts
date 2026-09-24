/**
 * 将已提交 ARC Evidence 和 GUIDE/WORKING 投影组成模型恢复消息。
 *
 * 消息只引用 Turn commit 与知识快照，不从 Pi transcript 反推 Environment；
 * RESET/checkpoint boundary 的确认由 runtime 在 Pi operation 接纳后调用。
 */

import type { ArtifactStore } from "../adapters/artifact-store.js";
import { buildBoundaryRecoveryPrompt, CHECKPOINT_PROMPT } from "../application/model-prompts.js";
import type { JsonValue } from "../protocol/canonical-json.js";
import type { KnowledgeStore } from "./knowledge-store.js";
import type { RuntimeAuthority } from "./pi-runtime.js";

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
		const history: JsonValue = records
			.filter((record) => record.recordType === "turn.commit" && record.payload.level === authority.turn.level)
			.map((record) => ({
				turn: record.payload.turn ?? null,
				actionId: record.payload.actionId ?? null,
				observation: record.payload.observation ?? null,
				observationDigest: record.payload.observationDigest ?? null,
			}));
		return buildBoundaryRecoveryPrompt({
			currentObservation: authority.turn.observation,
			lastActionResult:
				authority.turn.actionId === null
					? null
					: {
							turn: authority.turn.turn,
							actionId: authority.turn.actionId,
							observationDigest: authority.turn.observationDigest,
						},
			currentLevelHistory: history,
			guide,
			workingMemory: working,
		});
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
