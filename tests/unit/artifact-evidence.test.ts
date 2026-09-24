/** 只读模型视图必须从已提交 Turn 和全部 Raw Frame 归档重建。 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore, type RawFrame } from "../../src/adapters/artifact-store.js";
import { canonicalJsonDigest } from "../../src/adapters/sha256.js";
import { VisualPngPublisher } from "../../src/adapters/visual-png.js";
import { ArtifactEvidenceReader } from "../../src/composition/artifact-evidence.js";
import { renderVisual } from "../../src/domain/game-visual.js";

const at = "2026-09-24T00:00:00Z";

async function setup() {
	const root = await mkdtemp(path.join(tmpdir(), "pi-arc-evidence-"));
	const store = new ArtifactStore(root);
	const visuals = new VisualPngPublisher(root);
	await store.appendDomain("run.binding", at, { runId: "run-1", environmentInstanceId: "env-1" });
	const observation = { state: "NOT_FINISHED", levelsCompleted: 0, winLevels: 0, availableActions: ["ACTION1"] };
	for (let frame = 0; frame < 2; frame += 1) {
		const pixels = [
			[frame, 1],
			[2, 3],
		];
		const raw: RawFrame = {
			schema: "pi-arc.raw-frame.v1",
			width: 2,
			height: 2,
			pixels,
			runId: "run-1",
			environmentInstanceId: "env-1",
			turn: 0,
			frame,
			actionId: null,
			contentDigest: canonicalJsonDigest({ width: 2, height: 2, pixels }),
		};
		const framePath = await store.writeRawFrame(raw);
		const visualRef = await visuals.publish(0, frame, renderVisual(pixels));
		await store.writeVisualReference({
			visualRef,
			framePath,
			turn: 0,
			frame,
		});
	}
	await store.appendDomain("turn.commit", at, {
		turn: 0,
		level: 1,
		attempt: 1,
		actionId: null,
		frameCount: 2,
		observation,
		observationDigest: canonicalJsonDigest(observation),
	});
	return { root, store, reader: new ArtifactEvidenceReader(root, store) };
}

describe("artifact-only evidence reader", () => {
	it("selects the final initial Frame by default and explicit earlier Frames by index", async () => {
		const { reader } = await setup();
		expect((await reader.readFrame(0, null)).frame).toBe(1);
		expect((await reader.readFrame(0, 0)).visualRef).toBe("visuals/t000000/f000000.png");
		await expect(reader.readFrame(0, 2)).rejects.toMatchObject({ code: "not_found" });
	});

	it("rejects uncommitted Turn and tampered Raw Frame without consulting Environment", async () => {
		const { root, reader } = await setup();
		await expect(reader.readFrame(-1, null)).rejects.toMatchObject({ code: "invalid_request" });
		await expect(reader.readFrame(1, null)).rejects.toMatchObject({ code: "not_found" });
		const file = path.join(root, "frames", "t000000", "f000001.json");
		const raw = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8")) as RawFrame;
		await writeFile(
			file,
			JSON.stringify({
				...raw,
				pixels: [
					[15, 15],
					[15, 15],
				],
			}),
			"utf8",
		);
		await expect(reader.readFrame(0, 1)).rejects.toMatchObject({ code: "storage_failure" });
	});

	it("rejects a missing or altered archived Visual and damaged index", async () => {
		const { root, reader } = await setup();
		const visual = path.join(root, "visuals", "t000000", "f000001.png");
		const bytes = await readFile(visual);
		await rm(visual);
		await expect(reader.readFrame(0, null)).rejects.toMatchObject({ code: "not_found" });
		await writeFile(visual, Buffer.concat([bytes, Buffer.from([0])]));
		await expect(reader.readFrame(0, null)).rejects.toMatchObject({ code: "storage_failure" });
		await writeFile(path.join(root, "visuals", "index.jsonl"), "{not-json}\n");
		await expect(reader.readFrame(0, null)).rejects.toMatchObject({ code: "storage_failure" });
	});

	it("distinguishes a missing Visual index and a committed receipt without frames", async () => {
		const { root, store, reader } = await setup();
		await rm(path.join(root, "visuals", "index.jsonl"));
		await expect(reader.readFrame(0, null)).rejects.toMatchObject({ code: "not_found" });
		const pixels = [[1]];
		const raw: RawFrame = {
			schema: "pi-arc.raw-frame.v1",
			width: 1,
			height: 1,
			pixels,
			runId: "run-1",
			environmentInstanceId: "env-1",
			turn: 2,
			frame: 0,
			actionId: "action-2",
			contentDigest: canonicalJsonDigest({ width: 1, height: 1, pixels }),
		};
		const framePath = await store.writeRawFrame(raw);
		const visualRef = await new VisualPngPublisher(root).publish(2, 0, renderVisual(pixels));
		await store.writeVisualReference({ visualRef, framePath, turn: 2, frame: 0 });
		await store.appendDomain("environment.receipt", at, { actionId: "action-2" });
		await store.appendDomain("turn.commit", at, { turn: 2, level: 1, attempt: 1, actionId: "action-2" });
		await expect(reader.readFrame(2, null)).rejects.toMatchObject({ code: "not_found" });
	});

	it("does not silently substitute an earlier initial Frame when the final index entry is missing", async () => {
		const { root, reader } = await setup();
		const indexPath = path.join(root, "visuals", "index.jsonl");
		const lines = (await readFile(indexPath, "utf8")).trim().split("\n");
		await writeFile(indexPath, `${lines[0]}\n`, "utf8");
		await expect(reader.readFrame(0, null)).rejects.toMatchObject({ code: "storage_failure" });
	});

	it("rejects a committed Action Frame that differs from its Environment receipt", async () => {
		const { root, store, reader } = await setup();
		const pixels = [[4]];
		const raw: RawFrame = {
			schema: "pi-arc.raw-frame.v1",
			width: 1,
			height: 1,
			pixels,
			runId: "run-1",
			environmentInstanceId: "env-1",
			turn: 1,
			frame: 0,
			actionId: "action-1",
			contentDigest: canonicalJsonDigest({ width: 1, height: 1, pixels }),
		};
		const framePath = await store.writeRawFrame(raw);
		const visualRef = await new VisualPngPublisher(root).publish(1, 0, renderVisual(pixels));
		await store.writeVisualReference({ visualRef, framePath, turn: 1, frame: 0 });
		await store.appendDomain("environment.receipt", at, { actionId: "action-1", frames: [[[5]]] });
		await store.appendDomain("turn.commit", at, { turn: 1, level: 1, attempt: 1, actionId: "action-1" });
		await expect(reader.readFrame(1, 0)).rejects.toMatchObject({ code: "storage_failure" });
	});
});
