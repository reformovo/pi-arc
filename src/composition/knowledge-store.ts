/**
 * GUIDE、WORKING、RESET 与 checkpoint 的持久化投影。
 *
 * 唯一完成 marker 是 domain ledger 的 knowledge.commit/context.boundary。
 * Markdown snapshot 先按不可变路径原子发布；缺失 commit 时不得把半写入
 * 内容提升为活动知识。RESET 的活动 WORKING 直接由 Turn commit 推导，因而
 * 与新 Attempt 同时生效，不依赖后续 materialize 是否完成。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactStore, DomainRecord, KnowledgeSnapshot } from "../adapters/artifact-store.js";
import {
	KnowledgeConflictError,
	ModelToolError,
	type ToolCheckpoint,
	type ToolKnowledge,
} from "../application/model-tools.js";
import { canonicalJson, type JsonValue } from "../protocol/canonical-json.js";

type Kind = "guide" | "working";
const MAX_GUIDE = 65_536;
const MAX_WORKING = 16_384;

export interface KnowledgeIo {
	mkdir(directory: string): Promise<void>;
	readFile(file: string): Promise<string>;
	writeFile(file: string, content: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

const nodeIo: KnowledgeIo = {
	mkdir: async (directory) => {
		await mkdir(directory, { recursive: true });
	},
	readFile: (file) => readFile(file, "utf8"),
	writeFile: async (file, content) => {
		await writeFile(file, content, "utf8");
	},
	rename,
};

function digest(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function valueString(value: JsonValue | undefined, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is absent from the ledger`);
	return value;
}

function valueInteger(value: JsonValue | undefined, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`);
	return value;
}

function matchesCommitted(record: DomainRecord, kind: Kind, invocationId: string): boolean {
	return (
		record.recordType === "knowledge.commit" &&
		record.payload.kind === kind &&
		record.payload.invocationId === invocationId
	);
}

function snapshotPath(version: number, kind: string): string {
	return path.posix.join("knowledge", `v${String(version).padStart(6, "0")}-${kind}.md`);
}

function latest<T>(records: readonly T[], predicate: (record: T) => boolean): T | undefined {
	return [...records].reverse().find(predicate);
}

/** checkpoint 可在一条 ledger commit 中引用两个快照，版本不能只按 record 数量分配。 */
function nextKnowledgeVersion(records: readonly DomainRecord[]): number {
	let maximum = records.length;
	for (const record of records) {
		if (record.recordType !== "knowledge.commit") continue;
		for (const candidate of [record.payload.version, record.payload.guideVersion, record.payload.workingVersion]) {
			if (typeof candidate === "number" && Number.isSafeInteger(candidate)) maximum = Math.max(maximum, candidate);
		}
	}
	return maximum + 1;
}

interface Projection {
	guide: ToolKnowledge | null;
	working: ToolKnowledge | null;
}

export interface BoundaryEnvelope extends Record<string, JsonValue> {
	boundaryId: string;
	type: "reset" | "checkpoint";
	anchor: string;
	turn: number;
	guide: string;
	working: string;
	commitDigest: string;
}

export class KnowledgeStore {
	private tail: Promise<void> = Promise.resolve();

	constructor(
		private readonly root: string,
		private readonly artifacts: ArtifactStore,
		private readonly currentAnchor: () => string,
		private readonly now: () => string,
		private readonly io: KnowledgeIo = nodeIo,
	) {}

	private serialize<T>(task: () => Promise<T>): Promise<T> {
		const result = this.tail.then(task);
		this.tail = result.then(
			() => {},
			() => {},
		);
		return result;
	}

	private async writeOnce(relative: string, content: string): Promise<void> {
		const target = path.join(this.root, relative);
		await this.io.mkdir(path.dirname(target));
		try {
			const existing = await this.io.readFile(target);
			if (existing !== content) throw new KnowledgeConflictError(`${relative} conflicts with existing bytes`);
			return;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		const temporary = `${target}.partial`;
		await this.io.writeFile(temporary, content);
		await this.io.rename(temporary, target);
	}

	private async writeSnapshot(
		version: number,
		kind: Kind,
		content: string,
		anchor: string,
	): Promise<{ version: number; path: string; contentDigest: string }> {
		const relative = snapshotPath(version, kind);
		const contentDigest = digest(content);
		await this.writeOnce(relative, content);
		const snapshot: KnowledgeSnapshot = { version, kind, anchor, contentDigest, path: relative };
		await this.artifacts.writeKnowledgeSnapshot(snapshot);
		return { version, path: relative, contentDigest };
	}

	private async readSnapshot(value: JsonValue | undefined): Promise<string> {
		if (value === null || typeof value !== "object" || Array.isArray(value))
			throw new Error("snapshot reference is invalid");
		const ref = value as Record<string, JsonValue>;
		const relative = valueString(ref.path, "snapshot path");
		if (!/^knowledge\/v[0-9]{6,}-(?:guide|working)\.md$/.test(relative)) throw new Error("snapshot path is unsafe");
		const content = await this.io.readFile(path.join(this.root, relative));
		if (digest(content) !== ref.contentDigest) throw new Error("snapshot digest mismatch");
		return content;
	}

	private async projection(records: readonly DomainRecord[]): Promise<Projection> {
		const current: Projection = { guide: null, working: null };
		let level = 1;
		for (const record of records) {
			if (record.recordType === "turn.commit") {
				const newLevel = valueInteger(record.payload.level, "Turn Level");
				if (newLevel !== level) current.working = null;
				level = newLevel;
				const retryState = record.payload.retryState;
				if (record.payload.boundaryPending === true && typeof retryState === "string") {
					current.working = {
						kind: "working",
						content: retryState,
						version: record.sequence,
						anchor: this.currentAnchor(),
						contentDigest: digest(retryState),
						invocationId: null,
					};
				}
			}
			if (record.recordType !== "knowledge.commit") continue;
			const payload = record.payload;
			if (payload.kind === "guide" || payload.kind === "working") {
				const content = await this.readSnapshot(payload);
				current[payload.kind] = {
					kind: payload.kind,
					content,
					version: valueInteger(payload.version, "knowledge version"),
					anchor: valueString(payload.anchor, "knowledge anchor"),
					contentDigest: valueString(payload.contentDigest, "knowledge digest"),
					invocationId: typeof payload.invocationId === "string" ? payload.invocationId : null,
				};
			}
			if (payload.kind === "checkpoint") {
				for (const kind of ["guide", "working"] as const) {
					const ref = payload[kind];
					if (ref === null && kind === "guide") continue;
					const content = await this.readSnapshot(ref);
					const source = ref as Record<string, JsonValue>;
					current[kind] = {
						kind,
						content,
						version: valueInteger(source.version, "checkpoint version"),
						anchor: valueString(payload.anchor, "checkpoint anchor"),
						contentDigest: valueString(source.contentDigest, "checkpoint digest"),
						invocationId: valueString(payload.invocationId, "checkpoint invocation"),
					};
				}
			}
		}
		return current;
	}

	/** 只读取已提交快照；RESET Turn commit 自身即为新 WORKING 的权威 activation。 */
	async read(kind: Kind): Promise<ToolKnowledge | null> {
		if (kind === "working") await this.synchronizeLevelArchive();
		return (await this.projection(await this.artifacts.readDomain()))[kind];
	}

	/** stable invocation + 预期版本 + Environment anchor 三重条件保护完整替换。 */
	replace(input: {
		kind: Kind;
		content: string;
		invocationId: string;
		expectedVersion: number;
		anchor: string;
	}): Promise<ToolKnowledge> {
		return this.serialize(async () => {
			const limit = input.kind === "guide" ? MAX_GUIDE : MAX_WORKING;
			if (input.content.length === 0 || [...input.content].length > limit)
				throw new ModelToolError("invalid_request", "knowledge content is empty or too long");
			const records = await this.artifacts.readDomain();
			const existing = latest(records, (record) => matchesCommitted(record, input.kind, input.invocationId));
			if (existing !== undefined) {
				if (existing.payload.contentDigest !== digest(input.content) || existing.payload.anchor !== input.anchor)
					throw new KnowledgeConflictError("same invocation has different content or anchor");
				return (await this.projection(records.slice(0, records.indexOf(existing) + 1)))[
					input.kind
				] as ToolKnowledge;
			}
			if (input.anchor !== this.currentAnchor())
				throw new ModelToolError("anchor_conflict", "knowledge anchor changed");
			const current = (await this.projection(records))[input.kind];
			if ((current?.version ?? 0) !== input.expectedVersion)
				throw new KnowledgeConflictError("knowledge version changed");
			const version = nextKnowledgeVersion(records);
			const snapshot = await this.writeSnapshot(version, input.kind, input.content, input.anchor);
			await this.artifacts.appendDomain("knowledge.commit", this.now(), {
				kind: input.kind,
				invocationId: input.invocationId,
				anchor: input.anchor,
				...snapshot,
			});
			return {
				kind: input.kind,
				content: input.content,
				version,
				anchor: input.anchor,
				contentDigest: snapshot.contentDigest,
				invocationId: input.invocationId,
			};
		});
	}

	/** Context capacity 请求先持久化；未请求时 save 工具不得生效。 */
	requestCheckpoint(checkpointId: string, anchor: string): Promise<void> {
		return this.serialize(async () => {
			if (checkpointId.length === 0) throw new ModelToolError("invalid_request", "checkpointId is empty");
			if ((await this.artifacts.readTerminal()) !== undefined)
				throw new ModelToolError("terminal", "Run is terminated");
			if (anchor !== this.currentAnchor()) throw new ModelToolError("anchor_conflict", "checkpoint anchor changed");
			const records = await this.artifacts.readDomain();
			const active = this.activeCheckpoint(records);
			if (active !== undefined) {
				if (active.payload.checkpointId !== checkpointId || active.payload.anchor !== anchor)
					throw new KnowledgeConflictError("another checkpoint is active");
				return;
			}
			if (
				records.some(
					(record) => record.recordType === "checkpoint.request" && record.payload.checkpointId === checkpointId,
				)
			)
				throw new KnowledgeConflictError("checkpointId has already been settled");
			if (await this.boundaryPending())
				throw new ModelToolError("observation_required", "Context Boundary must be delivered first");
			await this.artifacts.appendDomain("checkpoint.request", this.now(), { checkpointId, anchor });
		});
	}

	private activeCheckpoint(records: readonly DomainRecord[]): DomainRecord | undefined {
		const request = latest(records, (record) => record.recordType === "checkpoint.request");
		if (request === undefined) return undefined;
		const settled = records.some(
			(record) =>
				record.sequence > request.sequence &&
				((record.recordType === "knowledge.commit" &&
					record.payload.kind === "checkpoint" &&
					record.payload.checkpointId === request.payload.checkpointId) ||
					(record.recordType === "context.boundary" &&
						record.payload.phase === "checkpoint.cancelled" &&
						record.payload.checkpointId === request.payload.checkpointId)),
		);
		return settled ? undefined : request;
	}

	async checkpointRequested(): Promise<boolean> {
		if ((await this.artifacts.readTerminal()) !== undefined) return false;
		return this.activeCheckpoint(await this.artifacts.readDomain()) !== undefined;
	}

	/** 只有 runtime 确认交付后才解除 gate；预先写好的 envelope 不等于模型已看见。 */
	async boundaryPending(): Promise<boolean> {
		const records = await this.artifacts.readDomain();
		const reset = latest(
			records,
			(record) => record.recordType === "turn.commit" && record.payload.boundaryPending === true,
		);
		const checkpoint = latest(
			records,
			(record) => record.recordType === "knowledge.commit" && record.payload.kind === "checkpoint",
		);
		const source =
			reset !== undefined && (checkpoint === undefined || reset.sequence > checkpoint.sequence) ? reset : checkpoint;
		if (source === undefined) return false;
		const type = source.recordType === "turn.commit" ? "reset" : "checkpoint";
		return !records.some(
			(record) =>
				record.recordType === "context.boundary" &&
				record.payload.boundaryId === `${type}-${source.sequence}` &&
				record.payload.phase === "acknowledged",
		);
	}

	/** 部分 snapshot/index 不会解除 gate；只有完整 commit marker 才生效。 */
	saveCheckpoint(input: {
		invocationId: string;
		guide: string | null;
		workingMemory: string;
		anchor: string;
	}): Promise<ToolCheckpoint> {
		return this.serialize(async () => {
			const records = await this.artifacts.readDomain();
			const existing = latest(
				records,
				(record) =>
					record.recordType === "knowledge.commit" &&
					record.payload.kind === "checkpoint" &&
					record.payload.invocationId === input.invocationId,
			);
			const guideDigest = input.guide === null ? null : digest(input.guide);
			const workingDigest = digest(input.workingMemory);
			if (existing !== undefined) {
				if (
					existing.payload.anchor !== input.anchor ||
					existing.payload.guideInputDigest !== guideDigest ||
					existing.payload.workingInputDigest !== workingDigest
				)
					throw new KnowledgeConflictError("checkpoint replay differs from committed content");
				return this.checkpointFrom(existing);
			}
			const request = this.activeCheckpoint(records);
			if (request === undefined) throw new ModelToolError("invalid_request", "checkpoint was not requested");
			if (input.anchor !== request.payload.anchor || input.anchor !== this.currentAnchor())
				throw new ModelToolError("anchor_conflict", "checkpoint anchor changed");
			if (input.guide !== null && (input.guide.length === 0 || [...input.guide].length > MAX_GUIDE))
				throw new ModelToolError("invalid_request", "GUIDE snapshot is invalid");
			if (input.workingMemory.length === 0 || [...input.workingMemory].length > MAX_WORKING)
				throw new ModelToolError("invalid_request", "WORKING snapshot is invalid");
			const projected = await this.projection(records);
			const version = nextKnowledgeVersion(records);
			const guide =
				input.guide === null ? null : await this.writeSnapshot(version, "guide", input.guide, input.anchor);
			const working = await this.writeSnapshot(version + 1, "working", input.workingMemory, input.anchor);
			const guideVersion = guide?.version ?? projected.guide?.version ?? 0;
			const commitDigest = digest(
				canonicalJson({
					checkpointId: request.payload.checkpointId ?? "",
					anchor: input.anchor,
					guideInputDigest: guideDigest,
					workingInputDigest: workingDigest,
					guideVersion,
					workingVersion: working.version,
				}),
			);
			const committed = await this.artifacts.appendDomain("knowledge.commit", this.now(), {
				kind: "checkpoint",
				checkpointId: request.payload.checkpointId ?? "",
				invocationId: input.invocationId,
				anchor: input.anchor,
				guide,
				working,
				guideInputDigest: guideDigest,
				workingInputDigest: workingDigest,
				guideVersion,
				workingVersion: working.version,
				commitDigest,
			});
			return this.checkpointFrom(committed);
		});
	}

	private checkpointFrom(record: DomainRecord): ToolCheckpoint {
		return {
			checkpointId: valueString(record.payload.checkpointId, "checkpointId"),
			anchor: valueString(record.payload.anchor, "checkpoint anchor"),
			guideVersion: valueInteger(record.payload.guideVersion, "guide version"),
			workingVersion: valueInteger(record.payload.workingVersion, "working version"),
			commitDigest: valueString(record.payload.commitDigest, "commit digest"),
		};
	}

	/** 完整 commit 后重复取得同一 envelope，不会重复 RESET 或改写知识。 */
	deliverBoundary(): Promise<BoundaryEnvelope | null> {
		return this.serialize(async () => {
			const records = await this.artifacts.readDomain();
			const reset = latest(
				records,
				(record) => record.recordType === "turn.commit" && record.payload.boundaryPending === true,
			);
			const checkpoint = latest(
				records,
				(record) => record.recordType === "knowledge.commit" && record.payload.kind === "checkpoint",
			);
			const source =
				reset !== undefined && (checkpoint === undefined || reset.sequence > checkpoint.sequence)
					? reset
					: checkpoint;
			if (source === undefined) return null;
			const type = source.recordType === "turn.commit" ? "reset" : "checkpoint";
			const boundaryId = `${type}-${source.sequence}`;
			const previous = latest(
				records,
				(record) =>
					record.recordType === "context.boundary" &&
					record.payload.boundaryId === boundaryId &&
					record.payload.phase !== "acknowledged",
			);
			if (previous !== undefined) return previous.payload as BoundaryEnvelope;
			const projected = await this.projection(records.slice(0, records.indexOf(source) + 1));
			const envelope: BoundaryEnvelope = {
				boundaryId,
				type,
				anchor: this.currentAnchor(),
				turn: valueInteger(latest(records, (record) => record.recordType === "turn.commit")?.payload.turn, "Turn"),
				guide: projected.guide?.content ?? "",
				working: projected.working?.content ?? "",
				commitDigest: source.digest,
			};
			await this.artifacts.appendDomain("context.boundary", this.now(), envelope);
			return envelope;
		});
	}

	/** runtime 已把 envelope 放入模型可见上下文后，才追加交付确认。 */
	acknowledgeBoundary(boundaryId: string): Promise<void> {
		return this.serialize(async () => {
			const records = await this.artifacts.readDomain();
			const prepared = latest(
				records,
				(record) =>
					record.recordType === "context.boundary" &&
					record.payload.boundaryId === boundaryId &&
					record.payload.phase !== "acknowledged",
			);
			if (prepared === undefined) throw new ModelToolError("not_found", "Boundary envelope is not prepared");
			if (
				records.some(
					(record) =>
						record.recordType === "context.boundary" &&
						record.payload.boundaryId === boundaryId &&
						record.payload.phase === "acknowledged",
				)
			)
				return;
			await this.artifacts.appendDomain("context.boundary", this.now(), {
				phase: "acknowledged",
				boundaryId,
				commitDigest: prepared.payload.commitDigest ?? "",
			});
		});
	}

	/** Level 切换时旧 WORKING 先归档；即使归档尚未完成，活动投影也已清空。 */
	synchronizeLevelArchive(): Promise<void> {
		return this.serialize(async () => {
			const records = await this.artifacts.readDomain();
			for (const [index, record] of records.entries()) {
				if (record.recordType !== "turn.commit" || index === 0) continue;
				const previous = latest(records.slice(0, index), (item) => item.recordType === "turn.commit");
				if (previous === undefined || record.payload.level === previous.payload.level) continue;
				const prior = (await this.projection(records.slice(0, index))).working;
				if (prior === null) continue;
				const relative = path.posix.join(
					"knowledge",
					"level-archive",
					`turn-${String(valueInteger(previous.payload.turn, "prior Turn")).padStart(6, "0")}.md`,
				);
				await this.writeOnce(relative, prior.content);
			}
		});
	}
}
