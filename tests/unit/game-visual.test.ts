import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	encodeVisualPng,
	VisualPngConflictError,
	VisualPngPublisher,
	visualPngPath,
} from "../../src/adapters/visual-png.js";
import {
	ARC_PALETTE,
	DISPLAY_SIZE,
	mapAction6Coordinate,
	mapAction6Point,
	normalizeRawFrame,
	RawFrameValidationError,
	readVisualPixel,
	renderInspectionRegion,
	renderVisual,
	sampleVisualRegion,
	VisualValidationError,
	validateVisualRegion,
} from "../../src/domain/game-visual.js";

const fullRegion = { x: 0, y: 0, width: DISPLAY_SIZE, height: DISPLAY_SIZE };

describe("Raw Frame 与 1024 Visual", () => {
	it("只接受 1..64 矩形网格和 0..15 整数颜色，并复制输入", () => {
		const input = [[0, 15]];
		const normalized = normalizeRawFrame(input);
		input[0]?.splice(0, 1, 8);
		expect(normalized).toEqual({ width: 2, height: 1, pixels: [[0, 15]] });
		expect(normalizeRawFrame(Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 0)))).toMatchObject({
			width: 64,
			height: 64,
		});

		for (const invalid of [
			[],
			Array.from({ length: 65 }, () => [0]),
			[[]],
			[Array.from({ length: 65 }, () => 0)],
			[[0], [0, 1]],
			[[0.5]],
			[[-1]],
			[[16]],
		]) {
			expect(() => normalizeRawFrame(invalid)).toThrow(RawFrameValidationError);
		}
	});

	it("按固定 palette 最近邻渲染，不在格点边界发明颜色", () => {
		const visual = renderVisual([
			[0, 1],
			[2, 15],
		]);
		expect(visual).toMatchObject({ width: 1024, height: 1024 });
		expect(readVisualPixel(visual, 0, 0)).toEqual(ARC_PALETTE[0]);
		expect(readVisualPixel(visual, 511, 511)).toEqual(ARC_PALETTE[0]);
		expect(readVisualPixel(visual, 512, 0)).toEqual(ARC_PALETTE[1]);
		expect(readVisualPixel(visual, 0, 512)).toEqual(ARC_PALETTE[2]);
		expect(readVisualPixel(visual, 1023, 1023)).toEqual(ARC_PALETTE[15]);
		expect(() => readVisualPixel(visual, 1024, 0)).toThrow(VisualValidationError);
		expect(() => readVisualPixel({ width: 2, height: 2, rgb: new Uint8Array(1) }, 0, 0)).toThrow(
			VisualValidationError,
		);
	});

	it("ACTION6 使用 floor(coordinate × 64 / 1024)", () => {
		expect([0, 15, 16, 1023].map(mapAction6Coordinate)).toEqual([0, 0, 1, 63]);
		expect(mapAction6Point(16, 1023)).toEqual({ x: 1, y: 63 });
		for (const invalid of [-1, 0.5, 1024]) expect(() => mapAction6Coordinate(invalid)).toThrow(VisualValidationError);
	});

	it("严格裁剪 region，并按最长边等比例最近邻放大", () => {
		const visual = renderVisual([
			[0, 1],
			[2, 15],
		]);
		expect(validateVisualRegion(fullRegion)).toEqual(fullRegion);
		const inspection = renderInspectionRegion(visual, { x: 512, y: 0, width: 512, height: 256 });
		expect(inspection).toMatchObject({ width: 1024, height: 512 });
		expect(readVisualPixel(inspection, 0, 0)).toEqual(ARC_PALETTE[1]);

		for (const invalid of [
			null,
			{ ...fullRegion, extra: true },
			{ ...fullRegion, x: 0.5 },
			{ ...fullRegion, x: -1 },
			{ ...fullRegion, width: 0 },
			{ x: 1023, y: 0, width: 2, height: 1 },
		]) {
			expect(() => validateVisualRegion(invalid)).toThrow(VisualValidationError);
		}
		expect(() =>
			renderInspectionRegion({ width: 1, height: 1, rgb: Uint8Array.from([0, 0, 0]) }, fullRegion),
		).toThrow("1024x1024");
	});

	it("read_pixels 按等分 bin 中心采样，并执行单次调用上限", () => {
		const visual = renderVisual([
			[0, 1],
			[2, 15],
		]);
		expect(sampleVisualRegion(visual, fullRegion, 2, 2)).toEqual([
			[ARC_PALETTE[0], ARC_PALETTE[1]],
			[ARC_PALETTE[2], ARC_PALETTE[15]],
		]);
		expect(() => sampleVisualRegion(visual, fullRegion, 0, 1)).toThrow(VisualValidationError);
		expect(() => sampleVisualRegion(visual, fullRegion, 65, 64)).toThrow(VisualValidationError);
		expect(() =>
			sampleVisualRegion({ width: 1, height: 1, rgb: Uint8Array.from([0, 0, 0]) }, fullRegion, 1, 1),
		).toThrow("1024x1024");
	});
});

describe("Visual PNG", () => {
	it("生成无 metadata 的确定性 PNG golden", () => {
		const visual = renderVisual([
			[0, 1],
			[2, 15],
		]);
		const first = encodeVisualPng(visual);
		const second = encodeVisualPng(visual);
		expect(first).toEqual(second);
		expect([...first.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
		expect(view.getUint32(16)).toBe(1024);
		expect(view.getUint32(20)).toBe(1024);
		let offset = 8;
		let compressed: Uint8Array | undefined;
		while (offset < first.length) {
			const length = view.getUint32(offset);
			const type = new TextDecoder().decode(first.subarray(offset + 4, offset + 8));
			if (type === "IDAT") compressed = first.slice(offset + 8, offset + 8 + length);
			offset += length + 12;
		}
		if (compressed === undefined) throw new Error("PNG golden has no IDAT chunk");
		const scanlines = inflateSync(compressed);
		expect(scanlines).toHaveLength((1024 * 3 + 1) * 1024);
		expect(scanlines[0]).toBe(0);
		expect(scanlines[(1024 * 3 + 1) * 1023]).toBe(0);
		expect(createHash("sha256").update(first).digest("hex")).toBe(
			"78bccd99ac2e6f9c4029fe92d4f7cdefec57ffbff84f067197ae6fe45868577f",
		);
		expect(() => encodeVisualPng({ width: 2, height: 2, rgb: new Uint8Array(1) })).toThrow(TypeError);
	});

	it("按稳定路径原子发布，且只允许相同内容的幂等 retry", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "pi-arc-visual-"));
		const publisher = new VisualPngPublisher(root);
		const first = renderVisual([[0]]);
		const relative = await publisher.publish(0, 1, first);
		expect(relative).toBe(path.join("visuals", "t000000", "f000001.png"));
		expect([...new Uint8Array(await readFile(path.join(root, relative))).slice(0, 8)]).toEqual([
			137, 80, 78, 71, 13, 10, 26, 10,
		]);
		await expect(publisher.publish(0, 1, first)).resolves.toBe(relative);
		await expect(publisher.publish(0, 1, renderVisual([[1]]))).rejects.toBeInstanceOf(VisualPngConflictError);
		await expect(publisher.publish(0, 2, { width: 1, height: 1, rgb: Uint8Array.from([0, 0, 0]) })).rejects.toThrow(
			"1024x1024",
		);
		expect(() => visualPngPath(-1, 0)).toThrow(TypeError);
	});
});
