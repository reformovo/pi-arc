/** 实际公开 provider 序列化测试；synthetic auth、mock fetch，无网络或正文导出。 */
import { createModels, type Message } from "@earendil-works/pi-ai";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { describe, expect, it } from "vitest";

interface CapturedRequest {
	messages: unknown[];
	session: string | null;
	model: string;
}

describe("OpenCode immutable context prefix", () => {
	it("keeps old serialized messages and session affinity stable when new evidence is appended", async () => {
		const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
		models.setProvider(opencodeGoProvider());
		const baseline = models.getModel("opencode-go", "deepseek-v4.1-flash");
		if (!baseline) throw new Error("missing public model baseline");
		const model = { ...baseline, id: "deepseek-flash", baseUrl: "https://diagnostic.invalid/v1" };
		const captured: CapturedRequest[] = [];
		const history: Message[] = Array.from({ length: 60 }, (_, index) => ({
			role: "user",
			timestamp: index,
			content: [
				{ type: "text", text: `visual-${index}` },
				{ type: "image", data: "AA==", mimeType: "image/png" },
			],
		}));
		const send = async (messages: Message[]) => {
			await models.completeSimple(
				model,
				{ systemPrompt: "fixed", messages },
				{
					apiKey: "synthetic-not-real",
					sessionId: "prefix-test:arc",
					env: {},
					reasoning: "max",
					maxRetries: 0,
					fetch: (url, init) => {
						expect(new URL(String(url)).hostname).toBe("diagnostic.invalid");
						if (typeof init?.body !== "string") throw new Error("unexpected request body");
						const body = JSON.parse(init.body) as { messages: unknown[]; model: string };
						captured.push({
							messages: body.messages,
							model: body.model,
							session: new Headers(init.headers).get("x-opencode-session"),
						});
						return Promise.resolve(
							new Response(
								'data: {"id":"mock","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
								{ headers: { "content-type": "text/event-stream" } },
							),
						);
					},
				},
			);
		};
		await send(history);
		await send([
			...history,
			{ role: "user", timestamp: 61, content: [{ type: "image", data: "AQ==", mimeType: "image/png" }] },
		]);
		expect(captured).toHaveLength(2);
		expect(captured[1]?.messages.slice(0, captured[0]?.messages.length)).toEqual(captured[0]?.messages);
		expect(captured.map((request) => request.session)).toEqual(["prefix-test:arc", "prefix-test:arc"]);
		expect(captured.map((request) => request.model)).toEqual(["deepseek-flash", "deepseek-flash"]);
	});
});
