/**
 * 模型只读工具的 Run archive 证据读取边界。
 *
 * 只使用已提交 Turn、Raw Frame 和 Visual index；Environment/sidecar、模型
 * transcript 与临时 PNG 都不能成为 history 或像素工具的数据来源。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactStore, RawFrame, VisualReference } from "../adapters/artifact-store.js";
import { canonicalJsonDigest } from "../adapters/sha256.js";
import { encodeVisualPng } from "../adapters/visual-png.js";
import { ModelToolError, type ToolEvidencePort, type ToolFrame } from "../application/model-tools.js";
import { normalizeRawFrame, renderVisual } from "../domain/game-visual.js";
import { canonicalJson } from "../protocol/canonical-json.js";

function pad(value: number): string {
	return String(value).padStart(6, "0");
}

export class ArtifactEvidenceReader implements ToolEvidencePort {
	constructor(
		private readonly root: string,
		private readonly artifacts: ArtifactStore,
	) {}

	readDomain() {
		return this.artifacts.readDomain();
	}

	/** 选择已提交 Observation 的指定帧，省略 frame 时取该响应的最后一帧。 */
	async readFrame(turn: number, frame: number | null): Promise<ToolFrame> {
		if (!Number.isSafeInteger(turn) || turn < 0 || (frame !== null && (!Number.isSafeInteger(frame) || frame < 0)))
			throw new ModelToolError("invalid_request", "Turn/Frame must be non-negative integers");
		const records = await this.artifacts.readDomain();
		const committed = records.find((record) => record.recordType === "turn.commit" && record.payload.turn === turn);
		if (committed === undefined) throw new ModelToolError("not_found", "Turn has not been committed");
		const actionId = committed.payload.actionId;
		const receipt =
			actionId === null
				? undefined
				: records.find(
						(record) => record.recordType === "environment.receipt" && record.payload.actionId === actionId,
					);
		let index: VisualReference[];
		try {
			index = (await readFile(path.join(this.root, "visuals", "index.jsonl"), "utf8"))
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as VisualReference);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				throw new ModelToolError("not_found", "Visual index is missing");
			throw new ModelToolError("storage_failure", "Visual index is corrupt");
		}
		const observedCount =
			receipt === undefined
				? index.filter((entry) => entry.turn === turn).length
				: Array.isArray(receipt.payload.frames)
					? receipt.payload.frames.length
					: 0;
		const declaredCount = committed.payload.frameCount;
		if (
			declaredCount !== undefined &&
			(typeof declaredCount !== "number" ||
				!Number.isSafeInteger(declaredCount) ||
				declaredCount < 1 ||
				(receipt !== undefined && declaredCount !== observedCount))
		)
			throw new ModelToolError("storage_failure", "committed Frame count is invalid");
		const count = typeof declaredCount === "number" ? declaredCount : observedCount;
		if (count < 1) throw new ModelToolError("not_found", "Turn has no committed Frames");
		const selected = frame ?? count - 1;
		if (selected >= count) throw new ModelToolError("not_found", "Frame is outside the committed Observation");
		const relative = path.posix.join("frames", `t${pad(turn)}`, `f${pad(selected)}.json`);
		let raw: RawFrame;
		try {
			raw = JSON.parse(await readFile(path.join(this.root, relative), "utf8")) as RawFrame;
		} catch {
			throw new ModelToolError("not_found", "archived Frame or Visual index is missing");
		}
		if (
			raw.schema !== "pi-arc.raw-frame.v1" ||
			raw.turn !== turn ||
			raw.frame !== selected ||
			raw.actionId !== actionId ||
			raw.runId !== records.find((record) => record.recordType === "run.binding")?.payload.runId ||
			raw.environmentInstanceId !==
				records.find((record) => record.recordType === "run.binding")?.payload.environmentInstanceId
		)
			throw new ModelToolError("storage_failure", "Raw Frame identity does not match committed Turn");
		const normalized = normalizeRawFrame(raw.pixels);
		if (
			raw.width !== normalized.width ||
			raw.height !== normalized.height ||
			raw.contentDigest !==
				canonicalJsonDigest({ width: normalized.width, height: normalized.height, pixels: normalized.pixels })
		)
			throw new ModelToolError("storage_failure", "Raw Frame digest is invalid");
		const receiptFrames = receipt === undefined ? null : receipt.payload.frames;
		if (
			receipt !== undefined &&
			(!Array.isArray(receiptFrames) || canonicalJson(raw.pixels) !== canonicalJson(receiptFrames[selected] ?? null))
		)
			throw new ModelToolError("storage_failure", "Raw Frame differs from committed Environment receipt");
		const references = index.filter(
			(entry) => entry.turn === turn && entry.frame === selected && entry.framePath === relative,
		);
		const reference = references[0];
		if (
			references.length !== 1 ||
			reference === undefined ||
			reference.visualRef !== path.posix.join("visuals", `t${pad(turn)}`, `f${pad(selected)}.png`)
		)
			throw new ModelToolError("storage_failure", "Visual source reference is missing or conflicts");
		const visual = renderVisual(normalized.pixels);
		let archived: Uint8Array;
		try {
			archived = await readFile(path.join(this.root, reference.visualRef));
		} catch {
			throw new ModelToolError("not_found", "archived Visual is missing");
		}
		// 编码规则确定性；逐字节校验后，内存 Visual 与归档 PNG 是同一证据。
		if (!Buffer.from(encodeVisualPng(visual)).equals(archived))
			throw new ModelToolError("storage_failure", "archived Visual differs from Raw Frame");
		return { turn, frame: selected, visualRef: reference.visualRef, visual };
	}
}
