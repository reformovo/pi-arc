/** 图片预算只改变模型投影，不改写历史或工具证据。 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { boundVisualContext } from "../../src/composition/visual-context.js";

describe("visual context budget", () => {
	it("keeps newest images and all text without mutating session messages", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: "plain", timestamp: 0 },
			{
				role: "user",
				content: [
					{ type: "text", text: "old" },
					{ type: "image", data: "old", mimeType: "image/png" },
				],
				timestamp: 1,
			},
			{
				role: "toolResult",
				toolCallId: "inspect1",
				toolName: "inspect",
				content: [
					{ type: "image", data: "middle", mimeType: "image/png" },
					{ type: "image", data: "newest", mimeType: "image/png" },
					{ type: "text", text: "reference" },
				],
				isError: false,
				timestamp: 2,
			},
		];
		const original = structuredClone(messages);
		const projected = boundVisualContext(messages, 1);
		expect(messages).toEqual(original);
		expect(projected[0]).toBe(messages[0]);
		expect(JSON.stringify(projected)).toContain('"data":"newest"');
		expect(JSON.stringify(projected)).not.toContain('"data":"old"');
		expect(JSON.stringify(projected)).not.toContain('"data":"middle"');
		expect(JSON.stringify(projected)).toContain("inspect1");
		expect(JSON.stringify(projected)).toContain("reference");
		expect(JSON.stringify(projected)).toContain("Use inspect");
		expect(boundVisualContext(messages, 3)).toEqual(messages);
	});
});
