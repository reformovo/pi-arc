import { describe, expect, it } from "vitest";
import { countContextImages, projectedToolImages } from "../../src/composition/image-capacity.js";

describe("append-only image admission", () => {
	it("counts only transmitted image parts without changing messages", () => {
		const messages = [
			{
				role: "user" as const,
				content: [
					{ type: "image" as const, data: "old", mimeType: "image/png" },
					{ type: "text" as const, text: "notes" },
				],
				timestamp: 0,
			},
		];
		const before = structuredClone(messages);
		expect(countContextImages(messages)).toBe(1);
		expect(messages).toEqual(before);
	});
	it("projects one play image, exact inspect outputs and zero text-only outputs", () => {
		expect(projectedToolImages("play", {})).toBe(1);
		for (let count = 1; count <= 16; count += 1)
			expect(projectedToolImages("inspect", { views: Array(count).fill({}) })).toBe(count);
		expect(projectedToolImages("history", {})).toBe(0);
		for (const views of [null, [], Array(17).fill({})]) expect(projectedToolImages("inspect", { views })).toBe(16);
	});
});
