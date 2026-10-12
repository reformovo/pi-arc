import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	createFixture,
	crossVisual,
	officialModels,
	runProbe,
	settle,
} from "../../scripts/probe-recovery-coordinate.mjs";
import { encodeVisualPng } from "../../src/adapters/visual-png.js";
import { mapAction6Point } from "../../src/domain/game-visual.js";

describe("synthetic recovery coordinate probe contract", () => {
	it("maps the requested visual center to native 25,7", () => {
		expect(mapAction6Point(408, 120)).toEqual({ x: 25, y: 7 });
		expect(mapAction6Point(25, 7)).toEqual({ x: 1, y: 0 });
	});

	it("faux control executes once; wrongly divided input misses", async () => {
		const good = await runProbe();
		expect(good).toMatchObject({
			requests: 0,
			synthetic: true,
			benchmark: false,
			mappingMatches: true,
			targetHit: true,
			native: { x: 25, y: 7 },
		});
		const wrong = await runProbe({
			response: {
				stopReason: "toolUse",
				content: [{ type: "toolCall", name: "play", arguments: { action: "ACTION6", x: 25, y: 7 } }],
			},
		});
		expect(wrong).toMatchObject({ mappingMatches: true, targetHit: false, native: { x: 1, y: 0 } });
	});

	it("uses actual recovery projection and prevents malformed or unsettled effects", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "probe-unit-"));
		try {
			const fixture = await createFixture(root);
			expect(fixture.envelope).toContain("canonical_replay_equivalent");
			expect(fixture.envelope).toContain("visual_1024");
			expect(fixture.envelope).toContain("Recovery coordinate rule:");
			for (const stopReason of ["length", "error", "aborted", "stop"]) {
				expect(
					await settle(fixture, {
						stopReason,
						content: [{ type: "toolCall", name: "play", arguments: { action: "ACTION6", x: 408, y: 120 } }],
					}),
				).toMatchObject({ reason: "inconclusive", targetHit: false });
			}
			for (const args of [
				{ action: "ACTION6", x: "408", y: 120 },
				{ action: "ACTION6", x: 408 },
				{ action: "ACTION6", x: 408, y: 120, extra: true },
			])
				await settle(fixture, {
					stopReason: "toolUse",
					content: [{ type: "toolCall", name: "play", arguments: args }],
				});
			expect(fixture.effects).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("encodes a valid 1024 PNG with a unique symmetric green cross center", () => {
		const png = Buffer.from(encodeVisualPng(crossVisual()));
		expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
		const compressed: Buffer[] = [];
		for (let offset = 8; offset < png.length; ) {
			const length = png.readUInt32BE(offset);
			const tagged = png.subarray(offset + 4, offset + 8 + length);
			let crc = 0xffffffff;
			for (const byte of tagged) {
				crc ^= byte;
				for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
			}
			expect(png.readUInt32BE(offset + 8 + length)).toBe((crc ^ 0xffffffff) >>> 0);
			const type = png.toString("ascii", offset + 4, offset + 8);
			if (type === "IHDR") {
				expect(png.readUInt32BE(offset + 8)).toBe(1024);
				expect(png.readUInt32BE(offset + 12)).toBe(1024);
			}
			if (type === "IDAT") compressed.push(png.subarray(offset + 8, offset + 8 + length));
			offset += length + 12;
		}
		const raw = inflateSync(Buffer.concat(compressed));
		const pixel = (x: number, y: number) => [...raw.subarray(y * 3073 + 1 + x * 3, y * 3073 + 4 + x * 3)];
		expect(pixel(408, 120)).toEqual([0, 255, 0]);
		expect(pixel(360, 120)).toEqual(pixel(456, 120));
		expect(pixel(408, 72)).toEqual(pixel(408, 168));
		expect(pixel(25, 7)).toEqual([16, 16, 16]);
	});

	it("rejects nonofficial endpoints and missing explicit official auth", () => {
		expect(() => officialModels({ OPENAI_BASE_URL: "https://example.com", OPENAI_API_KEY: "test" })).toThrow(
			"official_endpoint_required",
		);
		expect(() => officialModels({ OPENAI_BASE_URL: "https://api.deepseek.com" })).toThrow("official_auth_required");
	});

	it("keeps live execution explicit and bounded", async () => {
		const source = await readFile(path.join(process.cwd(), "scripts/probe-recovery-coordinate.mjs"), "utf8");
		expect(source).toContain('if (options.live && options.response) throw new Error("live_fixture_forbidden")');
		expect(source).toContain("requests: 1");
		expect(source).toContain("maxRetries: 0");
		expect(source).not.toContain("OPENCODE_API_KEY");
	});
});
