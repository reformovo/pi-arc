/** 冻结 VISTA 模型可见文本，防止 Pi 接入时无意改写已验证的行为基线。 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	buildBoundaryRecoveryPrompt,
	buildInitialTaskPrompt,
	CHECKPOINT_PROMPT,
	composeModelSystemPrompt,
	MODEL_TOOL_DEFINITIONS,
	NONTERMINAL_CONTINUATION_PROMPT,
	TASK_OBJECTIVE,
} from "../../src/application/model-prompts.js";
import { loadModelSystemPrompt } from "../../src/composition/prompt-loader.js";
import { validateJsonSchema } from "../../src/protocol/schema-validator.js";

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

const vistaDescriptionDigests: Record<string, string> = {
	inspect: "95d4d0bdf509bed166325ca53b50952138818456b84241207b4700899833c31b",
	read_pixels: "045186b4ec70beaa0c0aa4749058c419dcfbbb384840476a72864b0eb692f9fe",
	read_guide: "2a2920dc30a0069255aeed8f9f7c75b26102ef6bee7da8a629b6d7b5fa5691bf",
	write_guide: "5317398cfcf1a021ffd7cd07a2b36a9d855713e4b6d51b44fe2bcaa3f9578331",
	read_working: "37cc1f69bd69128372057d80b39473d0dc2b40bb71e98355b966aea37910de6e",
	save_compact_checkpoint: "331b4ee118edf10ae05916751784b44c01604ca84e35cffc6320680882b5608a",
};

describe("VISTA model-facing prompt baseline", () => {
	it("loads the byte-identical VISTA Markdown and a separate pi-arc addendum", async () => {
		const loaded = await loadModelSystemPrompt();
		expect(sha256(loaded.vistaPrompt)).toBe("cc857eef6d694946ba70b01e9070980705308d9e53f3373487722614d30dc120");
		expect(sha256(CHECKPOINT_PROMPT)).toBe("27916b0b3b7b64f937684b18eff4c04cb0af40acb12e60df8e6a86f0e61e6b68");
		expect(loaded.systemPrompt).toContain(loaded.vistaPrompt);
		expect(loaded.addendum).toContain("specific enough to check");
		expect(loaded.systemPrompt).toBe(composeModelSystemPrompt(loaded.vistaPrompt, loaded.addendum));
		expect(() => composeModelSystemPrompt("", loaded.addendum)).toThrow("empty");
		expect(TASK_OBJECTIVE).toBe("Complete the game with as few game actions as possible.");
		expect(NONTERMINAL_CONTINUATION_PROMPT).toBe(
			"The environment is still active. Context limits are handled automatically. Continue.",
		);
	});

	it("keeps six VISTA tool descriptions byte-identical and documents the three necessary adaptations", () => {
		expect(MODEL_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
			"play",
			"inspect",
			"read_pixels",
			"history",
			"read_guide",
			"write_guide",
			"read_working",
			"write_working",
			"save_compact_checkpoint",
		]);
		for (const tool of MODEL_TOOL_DEFINITIONS) {
			const expected = vistaDescriptionDigests[tool.name];
			if (expected !== undefined) expect(sha256(tool.description), tool.name).toBe(expected);
		}
		expect(MODEL_TOOL_DEFINITIONS[0]?.description).toContain("RESET restarts the current level after GAME_OVER");
		expect(MODEL_TOOL_DEFINITIONS[3]?.description).toContain("across this run's levels");
		expect(MODEL_TOOL_DEFINITIONS[7]?.description).toContain("via retry_state");
	});

	it("retains VISTA initial and boundary recovery message structure", () => {
		expect(buildInitialTaskPrompt({ state: "NOT_FINISHED" })).toBe(
			'Current observation:\n{"state":"NOT_FINISHED"}\n\nComplete the game with as few game actions as possible.',
		);
		const prompt = buildBoundaryRecoveryPrompt({
			currentObservation: { state: "GAME_OVER" },
			lastActionResult: { turn: 3 },
			currentLevelHistory: { attempts: [] },
			guide: "known rule",
			workingMemory: "retry from left",
		});
		expect(prompt).toContain(
			'Environment record:\n{"current_observation":{"state":"GAME_OVER"},"last_action_result":{"turn":3},"current_level_history":{"attempts":[]}}',
		);
		expect(prompt).toContain('Agent-authored notes:\n{"guide":"known rule","working_memory":"retry from left"}');
		expect(prompt).toContain("Continue the game with as few game actions as possible.");
	});

	it("publishes provider-neutral schema hints aligned with authoritative tool limits", () => {
		const byName = new Map(MODEL_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
		const play = byName.get("play");
		const inspect = byName.get("inspect");
		const pixels = byName.get("read_pixels");
		const checkpoint = byName.get("save_compact_checkpoint");
		expect(play?.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });
		expect(inspect?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
		expect(validateJsonSchema({ action: "ACTION6", x: 1023, y: 0 }, play?.inputSchema)).toEqual([]);
		expect(validateJsonSchema({ action: "ACTION6", x: 1024, y: 0 }, play?.inputSchema)).not.toEqual([]);
		expect(validateJsonSchema({ question: "q", views: [{ label: "v", turn: 0 }] }, inspect?.inputSchema)).toEqual([]);
		expect(
			validateJsonSchema(
				{
					question: "q",
					views: [{ label: "v", turn: 0, region: { x: 0, y: 0, width: 1, height: 1 }, rows: 1, columns: 1 }],
				},
				pixels?.inputSchema,
			),
		).toEqual([]);
		expect(validateJsonSchema({ guide: null, working_memory: "continue" }, checkpoint?.inputSchema)).toEqual([]);
		expect(validateJsonSchema({ guide: null }, checkpoint?.inputSchema)).not.toEqual([]);
	});
});
