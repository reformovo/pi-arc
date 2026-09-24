/** 使用临时 Run archive 验证知识快照的完成 marker、冲突和边界重放。 */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/adapters/artifact-store.js";
import { KnowledgeConflictError } from "../../src/application/model-tools.js";
import { type KnowledgeIo, KnowledgeStore } from "../../src/composition/knowledge-store.js";

const at = "2026-09-24T00:00:00Z";

async function setup(io?: KnowledgeIo) {
	const root = await mkdtemp(path.join(tmpdir(), "pi-arc-knowledge-"));
	const artifacts = new ArtifactStore(root);
	await artifacts.appendDomain("run.binding", at, { runId: "run-1", environmentInstanceId: "env-1" });
	await artifacts.appendDomain("turn.commit", at, {
		turn: 0,
		level: 1,
		attempt: 1,
		actionId: null,
		retryState: null,
		boundaryPending: false,
	});
	let anchor = "run-1:env-1:t0:a1:l1:g0:w0";
	const create = (port?: KnowledgeIo) =>
		new KnowledgeStore(
			root,
			artifacts,
			() => anchor,
			() => at,
			port,
		);
	return {
		root,
		artifacts,
		store: create(io),
		create,
		setAnchor: (value: string) => {
			anchor = value;
		},
	};
}

describe("knowledge store", () => {
	it("persists GUIDE/WORKING as versioned Markdown and replays only identical invocation", async () => {
		const { root, store, create, setAnchor } = await setup();
		const first = await store.replace({
			kind: "guide",
			content: "观察边界",
			invocationId: "write-guide-1",
			expectedVersion: 0,
			anchor: "run-1:env-1:t0:a1:l1:g0:w0",
		});
		expect(first).toMatchObject({ kind: "guide", content: "观察边界", version: 3 });
		expect(await readFile(path.join(root, "knowledge", "v000003-guide.md"), "utf8")).toBe("观察边界");
		const restarted = create();
		expect(await restarted.read("guide")).toEqual(first);
		expect(
			await restarted.replace({
				kind: "guide",
				content: "观察边界",
				invocationId: "write-guide-1",
				expectedVersion: 0,
				anchor: first.anchor,
			}),
		).toEqual(first);
		await expect(
			restarted.replace({
				kind: "guide",
				content: "不同内容",
				invocationId: "write-guide-1",
				expectedVersion: 0,
				anchor: first.anchor,
			}),
		).rejects.toBeInstanceOf(KnowledgeConflictError);
		await expect(
			restarted.replace({
				kind: "guide",
				content: "旧 anchor",
				invocationId: "other",
				expectedVersion: first.version,
				anchor: "stale",
			}),
		).rejects.toMatchObject({ code: "anchor_conflict" });
		setAnchor("run-1:env-1:t1:a1:l1:g3:w0");
		await expect(
			restarted.replace({
				kind: "guide",
				content: "旧版本",
				invocationId: "other",
				expectedVersion: 0,
				anchor: "run-1:env-1:t1:a1:l1:g3:w0",
			}),
		).rejects.toBeInstanceOf(KnowledgeConflictError);
	});

	it("RESET Turn commit atomically activates retry_state and boundary delivery is replayable", async () => {
		const { store, artifacts, setAnchor } = await setup();
		const working = await store.replace({
			kind: "working",
			content: "旧尝试",
			invocationId: "working-1",
			expectedVersion: 0,
			anchor: "run-1:env-1:t0:a1:l1:g0:w0",
		});
		await artifacts.appendDomain("action.intent", at, {
			actionId: "reset-1",
			action: { name: "RESET", data: {} },
			retryState: "换一种路径",
		});
		expect((await store.read("working"))?.content).toBe("旧尝试");
		await artifacts.appendDomain("turn.commit", at, {
			turn: 1,
			level: 1,
			attempt: 2,
			actionId: "reset-1",
			retryState: "换一种路径",
			boundaryPending: true,
		});
		setAnchor("run-1:env-1:t1:a2:l1:g0:w4");
		expect(await store.read("working")).toMatchObject({ content: "换一种路径", version: 5 });
		const first = await store.deliverBoundary();
		const second = await store.deliverBoundary();
		expect(first).toEqual(second);
		expect(first).toMatchObject({ type: "reset", turn: 1, working: "换一种路径" });
		expect(await store.boundaryPending()).toBe(true);
		expect((await artifacts.readDomain()).filter((record) => record.recordType === "context.boundary")).toHaveLength(
			1,
		);
		await store.acknowledgeBoundary(first?.boundaryId ?? "");
		await store.acknowledgeBoundary(first?.boundaryId ?? "");
		expect(await store.boundaryPending()).toBe(false);
		expect(await store.deliverBoundary()).toEqual(first);
		expect((await artifacts.readDomain()).filter((record) => record.recordType === "context.boundary")).toHaveLength(
			2,
		);
		expect(working.content).toBe("旧尝试");
	});

	it("Level change clears active WORKING and archives the previous Level", async () => {
		const { root, store, artifacts } = await setup();
		await store.replace({
			kind: "working",
			content: "第一关草稿",
			invocationId: "working-1",
			expectedVersion: 0,
			anchor: "run-1:env-1:t0:a1:l1:g0:w0",
		});
		await artifacts.appendDomain("turn.commit", at, {
			turn: 1,
			level: 2,
			attempt: 1,
			actionId: "level-1",
			retryState: null,
			boundaryPending: false,
		});
		expect(await store.read("working")).toBeNull();
		await store.synchronizeLevelArchive();
		expect(await readFile(path.join(root, "knowledge", "level-archive", "turn-000000.md"), "utf8")).toBe(
			"第一关草稿",
		);
	});

	it("checkpoint requires a request, commits all snapshots, and replays identical result", async () => {
		const { store, artifacts } = await setup();
		const input = {
			invocationId: "checkpoint-save-1",
			guide: "固定规则",
			workingMemory: "继续向右",
			anchor: "run-1:env-1:t0:a1:l1:g0:w0",
		};
		await expect(store.saveCheckpoint(input)).rejects.toMatchObject({ code: "invalid_request" });
		await store.requestCheckpoint("checkpoint-1", input.anchor);
		await store.requestCheckpoint("checkpoint-1", input.anchor);
		expect(await store.checkpointRequested()).toBe(true);
		const result = await store.saveCheckpoint(input);
		expect(result).toMatchObject({ checkpointId: "checkpoint-1", guideVersion: 4, workingVersion: 5 });
		expect(await store.checkpointRequested()).toBe(false);
		expect((await store.read("guide"))?.content).toBe("固定规则");
		expect((await store.read("working"))?.content).toBe("继续向右");
		expect(await store.saveCheckpoint(input)).toEqual(result);
		await expect(store.requestCheckpoint("checkpoint-1", input.anchor)).rejects.toBeInstanceOf(
			KnowledgeConflictError,
		);
		await expect(store.saveCheckpoint({ ...input, workingMemory: "冲突" })).rejects.toBeInstanceOf(
			KnowledgeConflictError,
		);
		const first = await store.deliverBoundary();
		expect(await store.deliverBoundary()).toEqual(first);
		expect(await store.boundaryPending()).toBe(true);
		expect((await artifacts.readDomain()).filter((record) => record.recordType === "context.boundary")).toHaveLength(
			1,
		);
		await store.acknowledgeBoundary(first?.boundaryId ?? "");
		expect(await store.boundaryPending()).toBe(false);
		const next = await store.replace({
			kind: "working",
			content: "下一版工作状态",
			invocationId: "working-after-checkpoint",
			expectedVersion: result.workingVersion,
			anchor: input.anchor,
		});
		expect(next.version).toBeGreaterThan(result.workingVersion);
		expect((await store.read("working"))?.content).toBe("下一版工作状态");
	});

	it("does not start checkpoint across an undelivered RESET boundary", async () => {
		const { store, artifacts, setAnchor } = await setup();
		await artifacts.appendDomain("turn.commit", at, {
			turn: 1,
			level: 1,
			attempt: 2,
			actionId: "reset-1",
			retryState: "换路线",
			boundaryPending: true,
		});
		setAnchor("run-1:env-1:t1:a2:l1:g0:w3");
		await expect(
			store.requestCheckpoint("checkpoint-after-reset", "run-1:env-1:t1:a2:l1:g0:w3"),
		).rejects.toMatchObject({
			code: "observation_required",
		});
		expect(await store.boundaryPending()).toBe(true);
		const envelope = await store.deliverBoundary();
		await expect(
			store.requestCheckpoint("checkpoint-after-reset", "run-1:env-1:t1:a2:l1:g0:w3"),
		).rejects.toMatchObject({
			code: "observation_required",
		});
		await store.acknowledgeBoundary(envelope?.boundaryId ?? "");
		await expect(
			store.requestCheckpoint("checkpoint-after-reset", "run-1:env-1:t1:a2:l1:g0:w3"),
		).resolves.toBeUndefined();
	});

	it("partial checkpoint snapshot never unlocks gate and can resume on the same anchor", async () => {
		const { root, artifacts, create } = await setup();
		const real = await import("node:fs/promises");
		let fail = true;
		const faulty: KnowledgeIo = {
			mkdir: async (directory) => {
				await real.mkdir(directory, { recursive: true });
			},
			readFile: (file) => real.readFile(file, "utf8"),
			writeFile: async (file, content) => {
				if (fail && file.includes("working")) {
					fail = false;
					throw new Error("injected snapshot fault");
				}
				await real.writeFile(file, content, "utf8");
			},
			rename: real.rename,
		};
		const store = create(faulty);
		const anchor = "run-1:env-1:t0:a1:l1:g0:w0";
		await store.requestCheckpoint("checkpoint-1", anchor);
		const input = { invocationId: "save-1", guide: "指南", workingMemory: "工作", anchor };
		await expect(store.saveCheckpoint(input)).rejects.toThrow("injected snapshot fault");
		expect(await store.checkpointRequested()).toBe(true);
		expect((await artifacts.readDomain()).filter((record) => record.recordType === "knowledge.commit")).toHaveLength(
			0,
		);
		const restarted = create();
		await expect(restarted.saveCheckpoint(input)).resolves.toMatchObject({ checkpointId: "checkpoint-1" });
		expect(await restarted.checkpointRequested()).toBe(false);
		expect(await readFile(path.join(root, "knowledge", "v000004-guide.md"), "utf8")).toBe("指南");
	});
});
