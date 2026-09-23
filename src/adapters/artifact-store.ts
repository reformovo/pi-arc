/**
 * 公共 pi-arc Run archive 的持久化存储边界。
 *
 * 本存储负责稳定路径、原子发布、hash chain 完整性和确定性 audit 重建；
 * 有意不负责判定 ARC 状态、执行 Environment effect、渲染 Visual，
 * 或解释 model/runtime payload。调用方必须串行化变更；并发 writer 的
 * 协调属于后续 controller package。
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { type NormalizedRawFrame, normalizeRawFrame, RawFrameValidationError } from "../domain/game-visual.js";
import { canonicalJson, type JsonValue } from "../protocol/canonical-json.js";

const ZERO_DIGEST = "0".repeat(64);
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

/** v1 artifact contract 要求的稳定 domain ledger event 词汇。 */
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

/** 标识一个 Run 及其输入的 write-once、无 secret snapshot。 */
export interface ArtifactManifest extends Record<string, JsonValue> {
	schema: "pi-arc.run-manifest.v1";
	runId: string;
}

/** append-only domain record；其 digest 承诺除自身以外的全部字段。 */
export interface DomainRecord extends Record<string, JsonValue> {
	schema: "pi-arc.domain-record.v1";
	sequence: number;
	recordedAt: string;
	recordType: ArtifactRecordType;
	previousDigest: string;
	digest: string;
	payload: Record<string, JsonValue>;
}

/** 用于诊断的 Pi/model event；可供检查，但绝不是 Environment 权威状态。 */
export interface RuntimeRecord extends Record<string, JsonValue> {
	schema: "pi-arc.runtime-record.v1";
	sequence: number;
	recordedAt: string;
	eventType: "model.requested" | "model.responded" | "tool.completed" | "tool.rejected" | "context.boundary";
	payload: Record<string, JsonValue>;
}

/** 未缩放的 Environment frame，绑定其 Run、instance、Turn 和可选 Action。 */
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

/** 从派生 Visual identity 回溯至其 Raw Frame source 的可审计链接。 */
export interface VisualReference extends Record<string, JsonValue> {
	visualRef: string;
	framePath: string;
	turn: number;
	frame: number;
}

/** 不可变 knowledge version index entry；内容存储由后续 package 负责。 */
export interface KnowledgeSnapshot extends Record<string, JsonValue> {
	version: number;
	anchor: string;
	kind: string;
	contentDigest: string;
}

/** CLI、SDK 和 audit consumer 必须保持区分的稳定顶层 outcome class。 */
export type TerminalOutcome = "win" | "non_success" | "unknown_outcome" | "audit_failure";

/** 唯一且 write-once 的 Run outcome，锚定终止前的 domain ledger head。 */
export interface TerminalRecord extends Record<string, JsonValue> {
	schema: "pi-arc.terminal.v1";
	runId: string;
	outcomeClass: TerminalOutcome;
	terminationReason: string;
	lastCommittedTurn: number;
	ledgerHead: string;
	recordedAt: string;
}

/** 无需访问 provider 即可重建的机器可读 archive integrity finding。 */
export interface AuditFinding extends Record<string, JsonValue> {
	code: string;
	severity: "info" | "error";
	message: string;
}

/** 确定性 audit projection；与 terminal.json 不同，audit.json 可以重建。 */
export interface AuditReport extends Record<string, JsonValue> {
	schema: "pi-arc.audit.v1";
	runId: string;
	ok: boolean;
	manifestDigest: string;
	ledgerHead: string;
	findings: AuditFinding[];
}

/** 可注入 storage port 所需的最小 directory entry surface。 */
export interface ArtifactDirEntry {
	name: string;
	isDirectory: boolean;
}

/**
 * 狭窄的 filesystem port，用于在测试中注入 crash 和 partial write 行为。
 * 实现必须保留基于 rename 的发布语义。
 */
export interface ArtifactIo {
	mkdir(directory: string): Promise<void>;
	readFile(file: string): Promise<string>;
	writeFile(file: string, content: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	stat(file: string): Promise<{ isFile(): boolean; isDirectory(): boolean }>;
	readdir(directory: string): Promise<ArtifactDirEntry[]>;
}

/** artifact storage port 的生产环境 Node filesystem 实现。 */
const nodeArtifactIo: ArtifactIo = {
	mkdir: async (directory) => {
		await mkdir(directory, { recursive: true });
	},
	readFile: (file) => readFile(file, "utf8"),
	writeFile: async (file, content) => {
		await writeFile(file, content, "utf8");
	},
	rename,
	stat,
	readdir: async (directory) =>
		(await readdir(directory, { withFileTypes: true })).map((entry) => ({
			name: entry.name,
			isDirectory: entry.isDirectory(),
		})),
};

function isSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= MAX_SAFE_INTEGER;
}

function isDigest(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isUtcTimestamp(value: unknown): value is string {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value);
}

function pad(value: number): string {
	return String(value).padStart(6, "0");
}

function digest(value: JsonValue): string {
	return createHash("sha256")
		.update(new TextEncoder().encode(canonicalJson(value)))
		.digest("hex");
}

function withoutDigest(record: DomainRecord): Record<string, JsonValue> {
	// record 不能把自身 digest 纳入哈希；保留 previousDigest 后，删除、重排或
	// 改写任意更早的 record 都会破坏其后的每一条链路。
	const { digest: _digest, ...digestable } = record;
	return digestable;
}

async function exists(io: ArtifactIo, file: string): Promise<boolean> {
	try {
		await io.stat(file);
		return true;
	} catch {
		return false;
	}
}

/** 调用方尝试用不同内容替换不可变 artifact。 */
export class ArtifactConflictError extends Error {
	readonly code = "artifact_conflict";
}

/** 现有 archive 字节不满足其结构或 digest contract。 */
export class ArtifactCorruptionError extends Error {
	readonly code = "artifact_corrupt";
}

/**
 * 支持只读独立 audit 的 single-writer Run archive adapter。
 * 幂等 retry 可以重复相同的 write-once 内容；冲突内容必须失败。
 */
export class ArtifactStore {
	private readonly root: string;
	private readonly io: ArtifactIo;

	/** 将 store 绑定到一个 artifact root 和可选的 fault-injectable I/O port。 */
	constructor(root: string, io: ArtifactIo = nodeArtifactIo) {
		this.root = path.resolve(root);
		this.io = io;
	}

	/** 创建稳定公共目录，但不创建 Run manifest 或 terminal。 */
	async initialize(): Promise<void> {
		await this.io.mkdir(this.root);
		await this.io.mkdir(path.join(this.root, "frames"));
		await this.io.mkdir(path.join(this.root, "visuals"));
		await this.io.mkdir(path.join(this.root, "knowledge"));
	}

	/** 只发布一次 Run manifest；内容相同的 retry 不产生操作。 */
	async writeManifest(manifest: ArtifactManifest): Promise<void> {
		await this.initialize();
		await this.writeOnce("manifest.json", manifest);
	}

	/** 使用整文件原子发布，追加一条经过校验且由哈希链接的 domain record。 */
	async appendDomain(
		recordType: ArtifactRecordType,
		recordedAt: string,
		payload: Record<string, JsonValue>,
	): Promise<DomainRecord> {
		if (!isUtcTimestamp(recordedAt)) throw new TypeError("recordedAt must be an RFC 3339 UTC timestamp");
		const records = await this.readDomainRecords();
		// 64 个零是 v1 contract 明确定义的 genesis anchor。
		const previousDigest = records.at(-1)?.digest ?? ZERO_DIGEST;
		const record: DomainRecord = {
			schema: "pi-arc.domain-record.v1",
			sequence: records.length + 1,
			recordedAt,
			recordType,
			previousDigest,
			digest: "0".repeat(64),
			payload,
		};
		record.digest = digest(withoutDigest(record));
		await this.writeJsonLines("domain.jsonl", [...records, record]);
		return record;
	}

	/** 追加诊断 runtime event，但不把它提升为 domain Evidence。 */
	async appendRuntime(
		eventType: RuntimeRecord["eventType"],
		recordedAt: string,
		payload: Record<string, JsonValue>,
	): Promise<RuntimeRecord> {
		if (!isUtcTimestamp(recordedAt)) throw new TypeError("recordedAt must be an RFC 3339 UTC timestamp");
		const records = await this.readRuntimeRecords();
		const record: RuntimeRecord = {
			schema: "pi-arc.runtime-record.v1",
			sequence: records.length + 1,
			recordedAt,
			eventType,
			payload,
		};
		await this.writeJsonLines("runtime.jsonl", [...records, record]);
		return record;
	}

	/** 校验一个不可变 Raw Frame，并发布到其稳定 Turn/Frame 路径。 */
	async writeRawFrame(frame: RawFrame): Promise<string> {
		this.validateRawFrame(frame);
		const relativePath = path.join("frames", `t${pad(frame.turn)}`, `f${pad(frame.frame)}.json`);
		await this.writeOnce(relativePath, frame);
		return relativePath;
	}

	/** 索引 Visual 到 Raw Frame 的关系；拒绝互相冲突的 identity。 */
	async writeVisualReference(reference: VisualReference): Promise<void> {
		if (!Number.isSafeInteger(reference.turn) || !Number.isSafeInteger(reference.frame)) {
			throw new TypeError("visual reference turn/frame must be safe integers");
		}
		const records = await this.readJsonLines<VisualReference>("visuals/index.jsonl");
		const same = records.find((item) => item.visualRef === reference.visualRef);
		if (same !== undefined && canonicalJson(same) !== canonicalJson(reference)) {
			throw new ArtifactConflictError(`visual reference ${reference.visualRef} conflicts`);
		}
		if (same === undefined) await this.writeJsonLines("visuals/index.jsonl", [...records, reference]);
	}

	/** 索引不可变 knowledge version，但不解释其内容。 */
	async writeKnowledgeSnapshot(snapshot: KnowledgeSnapshot): Promise<void> {
		if (!isSafeInteger(snapshot.version) || snapshot.version < 1 || !isDigest(snapshot.contentDigest)) {
			throw new TypeError("knowledge snapshot has invalid version or digest");
		}
		const records = await this.readJsonLines<KnowledgeSnapshot>("knowledge/index.jsonl");
		const same = records.find((item) => item.version === snapshot.version);
		if (same !== undefined && canonicalJson(same) !== canonicalJson(snapshot)) {
			throw new ArtifactConflictError(`knowledge version ${snapshot.version} conflicts`);
		}
		if (same === undefined) await this.writeJsonLines("knowledge/index.jsonl", [...records, snapshot]);
	}

	/** 发布唯一 terminal record；只有字节等价的 retry 才是幂等操作。 */
	async writeTerminal(terminal: TerminalRecord): Promise<void> {
		if (
			!isSafeInteger(terminal.lastCommittedTurn) ||
			terminal.lastCommittedTurn < 0 ||
			!isDigest(terminal.ledgerHead)
		) {
			throw new TypeError("terminal has invalid turn or ledger head");
		}
		if (!isUtcTimestamp(terminal.recordedAt)) throw new TypeError("terminal recordedAt must be UTC");
		await this.writeOnce("terminal.json", terminal);
	}

	/** 追加终止后的 Evidence，但不重新打开 Run，也不替换 terminal.json。 */
	async appendLateEvidence(recordedAt: string, payload: Record<string, JsonValue>): Promise<DomainRecord> {
		if (!(await exists(this.io, path.join(this.root, "terminal.json")))) {
			throw new ArtifactConflictError("late evidence requires a terminal record");
		}
		return this.appendDomain("post_terminal.evidence", recordedAt, payload);
	}

	/** 完全在内存中重建 archive 完整性；本方法绝不写入 audit.json。 */
	async audit(): Promise<AuditReport> {
		const findings: AuditFinding[] = [];
		const manifest = await this.readOptionalJson<ArtifactManifest>("manifest.json", findings, "manifest_corrupt");
		const runId = typeof manifest?.runId === "string" ? manifest.runId : "unknown";
		const manifestDigest = manifest === undefined ? ZERO_DIGEST : digest(manifest);
		const domain = await this.readDomainForAudit(findings);
		const ledgerHead = domain.at(-1)?.digest ?? ZERO_DIGEST;
		await this.collectPartialFiles(findings);
		await this.validateFrameFiles(findings, runId);
		try {
			await this.readRuntimeRecords();
		} catch (error) {
			findings.push({
				code: "runtime_corrupt",
				severity: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
		try {
			await this.readJsonLines<VisualReference>("visuals/index.jsonl");
			await this.readJsonLines<KnowledgeSnapshot>("knowledge/index.jsonl");
		} catch (error) {
			findings.push({
				code: "index_corrupt",
				severity: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
		await this.readOptionalJson<TerminalRecord>("terminal.json", findings, "terminal_corrupt");
		const terminal = await this.readOptionalJson<TerminalRecord>("terminal.json", [], "terminal_corrupt");
		if (manifest === undefined)
			findings.push({ code: "manifest_missing", severity: "error", message: "manifest.json is missing" });
		if (terminal === undefined)
			findings.push({ code: "terminal_missing", severity: "error", message: "terminal.json is missing" });
		// terminal.json 承诺的是终止时的 ledger。迟到 Evidence 会扩展 domain.jsonl，
		// 但绝不能让这个不可变 terminal anchor 失效。
		const terminalLedgerHead =
			domain.filter((record) => record.recordType !== "post_terminal.evidence").at(-1)?.digest ?? ZERO_DIGEST;
		if (terminal !== undefined && terminal.ledgerHead !== terminalLedgerHead) {
			findings.push({
				code: "terminal_ledger_mismatch",
				severity: "error",
				message: "terminal ledgerHead differs from domain ledger",
			});
		}
		return {
			schema: "pi-arc.audit.v1",
			runId,
			ok: !findings.some((finding) => finding.severity === "error"),
			manifestDigest,
			ledgerHead,
			findings,
		};
	}

	/** 重建并原子替换可变 audit projection。 */
	async rebuildAudit(): Promise<AuditReport> {
		const report = await this.audit();
		await this.atomicWrite("audit.json", canonicalJson(report));
		return report;
	}

	private async readDomainRecords(): Promise<DomainRecord[]> {
		const records = await this.readJsonLines<DomainRecord>("domain.jsonl");
		let previous = ZERO_DIGEST;
		for (const [index, record] of records.entries()) {
			if (record.schema !== "pi-arc.domain-record.v1" || record.sequence !== index + 1) {
				throw new ArtifactCorruptionError("domain ledger sequence or schema is invalid");
			}
			if (
				record.previousDigest !== previous ||
				!isDigest(record.digest) ||
				digest(withoutDigest(record)) !== record.digest
			) {
				throw new ArtifactCorruptionError("domain ledger hash chain is invalid");
			}
			previous = record.digest;
		}
		return records;
	}

	private async readRuntimeRecords(): Promise<RuntimeRecord[]> {
		const records = await this.readJsonLines<RuntimeRecord>("runtime.jsonl");
		for (const [index, record] of records.entries()) {
			if (record.schema !== "pi-arc.runtime-record.v1" || record.sequence !== index + 1) {
				throw new ArtifactCorruptionError("runtime record sequence or schema is invalid");
			}
		}
		return records;
	}

	private async readDomainForAudit(findings: AuditFinding[]): Promise<DomainRecord[]> {
		try {
			return await this.readDomainRecords();
		} catch (error) {
			findings.push({
				code: "ledger_corrupt",
				severity: "error",
				message: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
	}

	private async readOptionalJson<T>(
		relativePath: string,
		findings: AuditFinding[],
		code: string,
	): Promise<T | undefined> {
		try {
			const content = await this.io.readFile(path.join(this.root, relativePath));
			return JSON.parse(content) as T;
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
			findings.push({ code, severity: "error", message: `${relativePath} cannot be read` });
			return undefined;
		}
	}

	private async readJsonLines<T>(relativePath: string): Promise<T[]> {
		try {
			const content = await this.io.readFile(path.join(this.root, relativePath));
			return content
				.split("\n")
				.filter((line) => line.length > 0)
				.map((line) => JSON.parse(line) as T);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
			throw new ArtifactCorruptionError(`${relativePath} is not valid JSONL`);
		}
	}

	private async writeJsonLines(relativePath: string, records: readonly JsonValue[]): Promise<void> {
		await this.initialize();
		await this.atomicWrite(relativePath, records.map((record) => canonicalJson(record)).join(""));
	}

	private async writeOnce(relativePath: string, value: JsonValue): Promise<void> {
		await this.initialize();
		const target = path.join(this.root, relativePath);
		if (await exists(this.io, target)) {
			// 调用方丢失 settlement result 后，内容相同的 retry 仍然安全；不同值会
			// 改写历史，因此必须 fail closed。
			const current = JSON.parse(await this.io.readFile(target)) as JsonValue;
			if (canonicalJson(current) !== canonicalJson(value))
				throw new ArtifactConflictError(`${relativePath} is write-once`);
			return;
		}
		await this.atomicWrite(relativePath, canonicalJson(value));
	}

	private async atomicWrite(relativePath: string, content: string): Promise<void> {
		const target = path.join(this.root, relativePath);
		await this.io.mkdir(path.dirname(target));
		// 可见 target 只在 rename 时发生变化。rename 前 crash 会留下可审计的
		// .partial marker，而不是发布截断的规范化字节。
		const temporary = `${target}.partial`;
		await this.io.writeFile(temporary, content);
		await this.io.rename(temporary, target);
	}

	private validateRawFrame(frame: RawFrame): void {
		let normalized: NormalizedRawFrame;
		try {
			normalized = normalizeRawFrame(frame.pixels);
		} catch (error) {
			if (error instanceof RawFrameValidationError) throw new ArtifactCorruptionError(error.message);
			throw error;
		}
		if (normalized.width !== frame.width || normalized.height !== frame.height) {
			throw new ArtifactCorruptionError("raw frame pixels do not match dimensions");
		}
		// identity 字段由外层 record/path 认证；contentDigest 有意只承诺原始
		// grid 尺寸和 color matrix。
		const contentDigest = digest({ width: normalized.width, height: normalized.height, pixels: normalized.pixels });
		if (frame.contentDigest !== contentDigest) throw new ArtifactCorruptionError("raw frame content digest mismatch");
	}

	private async validateFrameFiles(findings: AuditFinding[], runId: string): Promise<void> {
		const files = await this.collectFiles(path.join(this.root, "frames"));
		for (const file of files.filter((item) => item.endsWith(".json"))) {
			try {
				const frame = JSON.parse(await this.io.readFile(file)) as RawFrame;
				this.validateRawFrame(frame);
				if (frame.runId !== runId) throw new ArtifactCorruptionError("raw frame runId differs from manifest");
			} catch (error) {
				findings.push({
					code: "raw_frame_corrupt",
					severity: "error",
					message: `${file}: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}
	}

	private async collectPartialFiles(findings: AuditFinding[]): Promise<void> {
		const files = await this.collectFiles(this.root);
		for (const file of files.filter((item) => item.endsWith(".partial"))) {
			findings.push({
				code: "partial_write",
				severity: "error",
				message: `${file} is an incomplete atomic publish`,
			});
		}
	}

	private async collectFiles(directory: string): Promise<string[]> {
		try {
			const entries = await this.io.readdir(directory);
			const files: string[] = [];
			for (const entry of entries) {
				const child = path.join(directory, entry.name);
				if (entry.isDirectory) files.push(...(await this.collectFiles(child)));
				else files.push(child);
			}
			return files;
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
			throw error;
		}
	}
}
