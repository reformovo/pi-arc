import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	ArtifactConflictError,
	type ArtifactIo,
	type ArtifactManifest,
	ArtifactStore,
	type RawFrame,
	type TerminalRecord,
} from "../../src/adapters/artifact-store.js";
import { canonicalJsonDigest } from "../../src/adapters/sha256.js";

const timestamp = "2026-09-23T00:00:00Z";

async function makeStore(): Promise<{ root: string; store: ArtifactStore }> {
	const root = await mkdtemp(path.join(tmpdir(), "pi-arc-artifact-"));
	return { root, store: new ArtifactStore(root) };
}

function manifest(): ArtifactManifest {
	return {
		schema: "pi-arc.run-manifest.v1",
		runId: "run-artifact-test",
		game: {
			id: "ls20-9607627b",
			sourceLocator: "arc-agi://public/ls20-9607627b?sdk=0.9.9",
			treeDigest: "0".repeat(64),
		},
		model: { provider: "fake", modelId: "offline-model" },
		runtime: { piAgentCore: "0.86.0", piAi: "0.86.0" },
		coordinates: 1024,
		seed: 42,
		config: { actionBudget: 10, gameOffline: true },
	};
}

function frame(): RawFrame {
	const pixels = [
		[0, 1],
		[2, 15],
	];
	return {
		schema: "pi-arc.raw-frame.v1",
		width: 2,
		height: 2,
		pixels,
		runId: "run-artifact-test",
		environmentInstanceId: "env-1",
		turn: 0,
		frame: 0,
		actionId: null,
		contentDigest: canonicalJsonDigest({ width: 2, height: 2, pixels }),
	};
}

async function completeArchive(store: ArtifactStore): Promise<{ ledgerHead: string }> {
	await store.writeManifest(manifest());
	await store.appendRuntime("model.requested", timestamp, { provider: "fake" });
	await store.writeRawFrame(frame());
	await store.writeVisualReference({
		visualRef: "visual-0",
		framePath: "frames/t000000/f000000.json",
		turn: 0,
		frame: 0,
	});
	await store.writeKnowledgeSnapshot({
		version: 1,
		anchor: "turn-0",
		kind: "guide",
		contentDigest: "1".repeat(64),
	});
	await store.appendDomain("run.binding", timestamp, { runId: "run-artifact-test" });
	const turn = await store.appendDomain("turn.commit", timestamp, { turn: 0 });
	const terminal: TerminalRecord = {
		schema: "pi-arc.terminal.v1",
		runId: "run-artifact-test",
		outcomeClass: "non_success",
		terminationReason: "action_budget_exhausted",
		lastCommittedTurn: 0,
		ledgerHead: turn.digest,
		recordedAt: timestamp,
	};
	await store.writeTerminal(terminal);
	return { ledgerHead: turn.digest };
}

describe("artifact store", () => {
	it("publishes stable entries and rebuilds deterministic audit", async () => {
		const { root, store } = await makeStore();
		const { ledgerHead } = await completeArchive(store);
		const report = await store.rebuildAudit();
		expect(report).toMatchObject({ schema: "pi-arc.audit.v1", runId: "run-artifact-test", ok: true, ledgerHead });
		expect(JSON.parse(await readFile(path.join(root, "audit.json"), "utf8"))).toEqual(report);
		expect((await readFile(path.join(root, "domain.jsonl"), "utf8")).split("\n").filter(Boolean)).toHaveLength(2);
		expect(await readFile(path.join(root, "runtime.jsonl"), "utf8")).toContain("model.requested");
	});

	it("keeps terminal write-once and appends late evidence without changing terminal head", async () => {
		const { store } = await makeStore();
		const { ledgerHead } = await completeArchive(store);
		const terminal: TerminalRecord = {
			schema: "pi-arc.terminal.v1",
			runId: "run-artifact-test",
			outcomeClass: "non_success",
			terminationReason: "action_budget_exhausted",
			lastCommittedTurn: 0,
			ledgerHead,
			recordedAt: timestamp,
		};
		await store.writeTerminal(terminal);
		await expect(store.writeTerminal({ ...terminal, terminationReason: "cancelled" })).rejects.toBeInstanceOf(
			ArtifactConflictError,
		);
		// 迟到 observation 会扩展 Evidence，但不可变 terminal record 仍锚定
		// 终止前的最后一条 domain record。
		const late = await store.appendLateEvidence(timestamp, { observedAfterTermination: true });
		expect(late.recordType).toBe("post_terminal.evidence");
		expect((await store.audit()).ok).toBe(true);
	});

	it("detects tampered ledger, corrupt frame and incomplete atomic publish", async () => {
		const { root, store } = await makeStore();
		await completeArchive(store);
		const domainPath = path.join(root, "domain.jsonl");
		const domain = await readFile(domainPath, "utf8");
		// 同时破坏三个独立完整性层，用一次 audit 证明 ledger、frame content
		// 和发布中断三类 finding 仍可区分。
		await writeFile(domainPath, domain.replace("run.binding", "turn.commit"), "utf8");
		await writeFile(path.join(root, "frames", "t000000", "f000000.json"), JSON.stringify({ broken: true }), "utf8");
		await writeFile(path.join(root, "runtime.jsonl.partial"), "partial", "utf8");
		const report = await store.audit();
		expect(report.ok).toBe(false);
		expect(report.findings.map((finding) => finding.code)).toEqual(
			expect.arrayContaining(["ledger_corrupt", "raw_frame_corrupt", "partial_write"]),
		);
	});

	it("leaves a partial marker when storage fails during atomic publish", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "pi-arc-artifact-fault-"));
		const { mkdir: makeDirectory, readFile: read, rename, stat, readdir } = await import("node:fs/promises");
		// 在部分字节写入临时路径后、rename 前注入故障；最终路径不得发布，
		// audit 必须报告 crash marker。
		const failingIo: ArtifactIo = {
			mkdir: async (directory) => {
				await makeDirectory(directory, { recursive: true });
			},
			readFile: (file) => read(file, "utf8"),
			writeFile: async (file, content) => {
				await writeFile(file, content.slice(0, 4), "utf8");
				throw new Error("injected storage fault");
			},
			rename,
			stat,
			readdir: async (directory) =>
				(await readdir(directory, { withFileTypes: true })).map((entry) => ({
					name: entry.name,
					isDirectory: entry.isDirectory(),
				})),
		};
		const store = new ArtifactStore(root, failingIo);
		await expect(store.writeManifest(manifest())).rejects.toThrow("injected storage fault");
		const report = await store.audit();
		expect(report.findings.map((finding) => finding.code)).toContain("partial_write");
	});

	it("rejects invalid timestamps, frames, duplicate visual references and knowledge conflicts", async () => {
		const { root, store } = await makeStore();
		await expect(store.appendDomain("run.binding", "not-a-time", {})).rejects.toThrow("RFC 3339");
		await expect(store.appendRuntime("model.requested", "not-a-time", {})).rejects.toThrow("RFC 3339");
		const valid = frame();
		await expect(store.writeRawFrame({ ...valid, width: 0 })).rejects.toThrow("dimensions");
		await expect(store.writeRawFrame({ ...valid, pixels: [[0]] })).rejects.toThrow("dimensions");
		await expect(
			store.writeRawFrame({
				...valid,
				pixels: [
					[0, 16],
					[2, 15],
				],
			}),
		).rejects.toThrow("color");
		await expect(store.writeRawFrame({ ...valid, contentDigest: "0".repeat(64) })).rejects.toThrow("digest");
		await store.writeVisualReference({ visualRef: "visual-1", framePath: "frame.json", turn: 0, frame: 0 });
		await expect(
			store.writeVisualReference({ visualRef: "visual-1", framePath: "other.json", turn: 0, frame: 0 }),
		).rejects.toBeInstanceOf(ArtifactConflictError);
		await store.writeKnowledgeSnapshot({ version: 1, anchor: "a", kind: "guide", contentDigest: "1".repeat(64) });
		await expect(
			store.writeKnowledgeSnapshot({ version: 1, anchor: "b", kind: "guide", contentDigest: "2".repeat(64) }),
		).rejects.toBeInstanceOf(ArtifactConflictError);
		await expect(store.appendLateEvidence(timestamp, {})).rejects.toBeInstanceOf(ArtifactConflictError);
		await expect(store.writeManifest(manifest())).resolves.toBeUndefined();
		await expect(store.writeManifest({ ...manifest(), runId: "other-run" })).rejects.toBeInstanceOf(
			ArtifactConflictError,
		);
		await expect(
			store.writeKnowledgeSnapshot({ version: 2, anchor: "b", kind: "guide", contentDigest: "not-a-digest" }),
		).rejects.toThrow("digest");
		await expect(store.writeRawFrame({ ...valid, actionId: "action-1" })).resolves.toBe(
			"frames/t000000/f000000.json",
		);
		await expect(store.writeRawFrame({ ...valid, actionId: "action-2" })).rejects.toBeInstanceOf(
			ArtifactConflictError,
		);
		await expect(store.audit()).resolves.toMatchObject({ ok: false });
		await expect(readFile(path.join(root, "manifest.json"), "utf8")).resolves.toContain("run-artifact-test");
	});

	it("reports absent archive entries and runtime/index corruption", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "pi-arc-empty-"));
		const store = new ArtifactStore(root);
		const empty = await store.audit();
		expect(empty.findings.map((finding) => finding.code)).toEqual(
			expect.arrayContaining(["manifest_missing", "terminal_missing"]),
		);
		await store.writeManifest(manifest());
		await writeFile(
			path.join(root, "runtime.jsonl"),
			`${JSON.stringify({ schema: "wrong", sequence: 3 })}\n`,
			"utf8",
		);
		await writeFile(path.join(root, "visuals", "index.jsonl"), "not-json\n", "utf8");
		const report = await store.audit();
		expect(report.findings.map((finding) => finding.code)).toEqual(
			expect.arrayContaining(["runtime_corrupt", "index_corrupt", "terminal_missing"]),
		);
	});

	it("fails closed when recovery reads a corrupt terminal record", async () => {
		const { root, store } = await makeStore();
		await completeArchive(store);
		await writeFile(path.join(root, "terminal.json"), "not-json", "utf8");
		await expect(store.readTerminal()).rejects.toThrow("terminal.json cannot be read");
	});
});
