import { execFileSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { createModels, type FetchFunction, type Models } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { offlineFetch, runProbe } from "../../scripts/probe-vision-cache.mjs";
import { createCliModels } from "../../src/composition/cli-models.js";

type Part = { type: string; text?: string; image_url?: { url: string } };
type WireMessage = {
	role: string;
	content: string | Part[];
	reasoning_content?: string;
	tool_call_id?: string;
	tool_calls?: { id: string; function: { name: string; arguments: string } }[];
};
type Body = {
	model: string;
	messages: WireMessage[];
	max_tokens: number;
	reasoning_effort: string;
	thinking: { type: string };
	temperature: number;
	stream: boolean;
};

function imageUrls(body: Body): string[] {
	return body.messages.flatMap((message) =>
		Array.isArray(message.content)
			? message.content.flatMap((part) => (part.image_url ? [part.image_url.url] : []))
			: [],
	);
}

function assertPng(url: string, size = 2) {
	const png = Buffer.from(url.replace("data:image/png;base64,", ""), "base64");
	expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
	expect(png.readUInt32BE(16)).toBe(size);
	expect(png.readUInt32BE(20)).toBe(size);
	expect(png[24]).toBe(8);
	expect(png[25]).toBe(2);
	let offset = 8;
	let decoded = Buffer.alloc(0);
	while (offset < png.length) {
		const length = png.readUInt32BE(offset);
		let crc = 0xffffffff;
		for (const byte of png.subarray(offset + 4, offset + 8 + length)) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
		expect(png.readUInt32BE(offset + 8 + length)).toBe((crc ^ 0xffffffff) >>> 0);
		if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
			decoded = inflateSync(png.subarray(offset + 8, offset + 8 + length));
		offset += 12 + length;
	}
	expect(offset).toBe(png.length);
	expect(decoded.length).toBe(size * (1 + size * 3));
	for (let row = 0; row < size; row++) expect(decoded[row * (1 + size * 3)]).toBe(0);
}

describe("standalone synthetic vision cache probe (OFFLINE)", () => {
	it("uses public provider wire shapes, one session, fixed baseline, and at most eight calls", async () => {
		const completeSpy = vi.spyOn(Object.getPrototypeOf(createModels()) as Models, "completeSimple");
		const bodies: Body[] = [];
		const sessions: (string | null)[] = [];
		const mockFetch: FetchFunction = (input, init) => {
			expect(String(input)).toBe("https://offline.invalid/v1/chat/completions");
			expect(typeof init?.body).toBe("string");
			bodies.push(JSON.parse(String(init?.body)) as Body);
			sessions.push(new Headers(init?.headers).get("x-opencode-session"));
			return offlineFetch(input, init);
		};
		const report = await runProbe({ mockFetch });
		expect(report.success).toBe(true);
		expect(bodies).toHaveLength(8);
		expect(report.requests.map((request) => request.imageCount)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
		expect(report.requests.every((request) => request.oldPrefixEqual && request.configStable)).toBe(true);
		const base = bodies[0];
		if (!base) throw new Error("missing synthetic body");
		expect(base.model).toBe("deepseek-flash");
		expect(base.max_tokens).toBe(256);
		expect(base.reasoning_effort).toBe("max");
		expect(base.thinking).toEqual({ type: "enabled" });
		expect(base.temperature).toBe(0);
		// OpenCode's public provider wrapper, not a custom header/payload rewrite.
		expect(sessions[0]).toMatch(/^synthetic-vision-cache-[a-f0-9]{32}$/);
		expect(sessions).toEqual(Array(8).fill(sessions[0]));
		expect(completeSpy).toHaveBeenCalledTimes(8);
		for (const call of completeSpy.mock.calls) {
			expect(call[2]).toMatchObject({
				sessionId: sessions[0],
				maxTokens: 256,
				reasoning: "max",
				maxRetries: 0,
				timeoutMs: 120_000,
			});
			expect(call[2]?.signal).toBeInstanceOf(AbortSignal);
		}
		for (let index = 0; index < bodies.length; index++) {
			const body = bodies[index];
			if (!body) throw new Error("missing synthetic body");
			expect(body.messages.slice(0, 2)).toEqual(base.messages);
			expect(body.messages).toHaveLength(index < 2 ? 2 : 4);
			if (index % 2 === 1) expect(body).toEqual(bodies[index - 1]);
			if (index >= 2) expect(body.messages[2]).toMatchObject({ role: "assistant", content: "OK" });
		}
		const baseImages = imageUrls(base);
		const same = bodies[4];
		const different = bodies[6];
		if (!same || !different) throw new Error("missing extensions");
		expect(imageUrls(same)).toEqual([baseImages[0], baseImages[0]]);
		expect(imageUrls(different)[0]).toBe(baseImages[0]);
		expect(imageUrls(different)[1]).not.toBe(baseImages[0]);
		for (const image of imageUrls(different)) assertPng(image);
		const serialized = JSON.stringify(report);
		for (const forbidden of [
			"Synthetic tile",
			"data:image",
			"authorization",
			"synthetic-offline-not-a-credential",
			"https://",
			"messages",
			"headers",
			"content",
		])
			expect(serialized).not.toContain(forbidden);
		expect(report.budget.maxOutputTokensAllRequests).toBe(2048);
		expect(report.budget.dollarCapGuaranteed).toBe(false);
		completeSpy.mockRestore();
	});

	it("varies only pixels, then tool layout, then synthetic reasoning; sessions never alias runs", async () => {
		const runs: Body[][] = [];
		const reports = [];
		const sessions: string[] = [];
		for (const stage of ["tiny", "large", "tool", "reasoning"] as const) {
			const bodies: Body[] = [];
			const report = await runProbe({
				stage,
				mockFetch: (input, init) => {
					bodies.push(JSON.parse(String(init?.body)) as Body);
					const session = new Headers(init?.headers).get("x-opencode-session");
					if (!session) throw new Error("missing session");
					if (bodies.length === 1) sessions.push(session);
					expect(session).toBe(sessions[sessions.length - 1]);
					return offlineFetch(input, init);
				},
			});
			expect(report.success).toBe(true);
			expect(report.stage).toBe(stage);
			expect(report.requests).toHaveLength(8);
			expect(report.requests.every((r) => r.configStable)).toBe(true);
			expect(report.requests.filter((_, i) => i % 2 === 1).every((r) => r.repeatEqual)).toBe(true);
			for (let i = 1; i < 8; i += 2) expect(bodies[i]).toEqual(bodies[i - 1]);
			for (const image of imageUrls(bodies[6] as Body)) assertPng(image, stage === "tiny" ? 2 : 1024);
			const serialized = JSON.stringify(report);
			for (const forbidden of [
				"Synthetic tile",
				"Synthetic reasoning",
				"synthetic_visual",
				"synthetic_base",
				"data:image",
				"reasoning_content",
				sessions[sessions.length - 1] ?? "missing-session",
				"headers",
				"messages",
				"authorization",
			]) {
				expect(serialized).not.toContain(forbidden);
			}
			runs.push(bodies);
			reports.push(report);
		}
		expect(new Set(sessions).size).toBe(4);
		expect(new Set(reports.map((r) => r.experimentId)).size).toBe(4);
		const [tiny, large, tool, reasoning] = runs;
		if (!tiny || !large || !tool || !reasoning) throw new Error("missing run");
		const withoutImages = (body: Body) =>
			JSON.parse(JSON.stringify(body).replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "SYNTHETIC_IMAGE"));
		for (let i = 0; i < 8; i++) {
			const largeBody = large[i];
			const toolBody = tool[i];
			const reasoningBody = reasoning[i];
			if (!largeBody || !toolBody || !reasoningBody) throw new Error("missing body");
			expect(withoutImages(largeBody)).toEqual(withoutImages(tiny[i] as Body));
			expect(imageUrls(toolBody)).toEqual(imageUrls(largeBody));
			expect(imageUrls(reasoningBody)).toEqual(imageUrls(toolBody));
			const stripped = structuredClone(reasoningBody);
			for (const message of stripped.messages) {
				if (message.tool_calls?.[0]?.id === "synthetic_base") {
					expect(message.reasoning_content?.length).toBeGreaterThan(64000);
					const original = toolBody.messages[stripped.messages.indexOf(message)]?.reasoning_content;
					if (original === undefined) delete message.reasoning_content;
					else message.reasoning_content = original;
				}
			}
			expect(stripped).toEqual(toolBody);
			const calls = toolBody.messages.flatMap((m) => m.tool_calls ?? []);
			const results = toolBody.messages.filter((m) => m.role === "tool");
			expect(calls.map((c) => c.id)).toEqual(i < 2 ? ["synthetic_base"] : ["synthetic_base", "synthetic_extension"]);
			expect(results.map((r) => r.tool_call_id)).toEqual(calls.map((c) => c.id));
			for (const call of calls) expect(call.function).toEqual({ name: "synthetic_visual", arguments: "{}" });
			// Public completions adapter hoists tool-result images into synthetic user messages.
			expect(toolBody.messages.filter((m) => Array.isArray(m.content)).every((m) => m.role === "user")).toBe(true);
			const baseline = tool[0];
			if (!baseline) throw new Error("missing baseline");
			expect(reports[2]?.requests[i]?.oldPrefixEqual).toBe(
				JSON.stringify(toolBody.messages.slice(0, baseline.messages.length)) === JSON.stringify(baseline.messages),
			);
		}
	});

	it("long stages differ only in base user order, with immutable extensions and independent sessions", async () => {
		const runs: Body[][] = [];
		const sessions: string[] = [];
		for (const stage of ["large", "long-before", "long-after"] as const) {
			const bodies: Body[] = [];
			const report = await runProbe({
				stage,
				mockFetch: (input, init) => {
					bodies.push(JSON.parse(String(init?.body)) as Body);
					const session = new Headers(init?.headers).get("x-opencode-session");
					if (!session) throw new Error("missing session");
					if (bodies.length === 1) sessions.push(session);
					expect(session).toBe(sessions.at(-1));
					return offlineFetch(input, init);
				},
			});
			expect(report.success).toBe(true);
			expect(bodies).toHaveLength(8);
			expect(report.requests.map((r) => r.label)).toEqual([
				"base",
				"base-repeat",
				"text-extension",
				"text-repeat",
				"same-image-extension",
				"same-image-repeat",
				"new-image-extension",
				"new-image-repeat",
			]);
			expect(report.requests.every((r) => r.oldPrefixEqual && r.configStable)).toBe(true);
			expect(report.requests.map((r) => r.imageCount)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
			for (let i = 0; i < 8; i++) {
				const body = bodies[i] as Body;
				expect(body.messages.slice(0, 2)).toEqual(bodies[0]?.messages);
				expect(body.messages).toHaveLength(i < 2 ? 2 : 4);
				if (i % 2) expect(body).toEqual(bodies[i - 1]);
				expect(body.messages.every((m) => !m.tool_calls && !m.tool_call_id && !m.reasoning_content)).toBe(true);
			}
			const urls = imageUrls(bodies[6] as Body);
			for (const url of urls) assertPng(url, 1024);
			expect(imageUrls(bodies[4] as Body)).toEqual([urls[0], urls[0]]);
			expect(urls[1]).not.toBe(urls[0]);
			if (stage !== "large") {
				expect(report.longHistory).toMatchObject({
					expansionFactor: 4,
					estimatedTextTokens: 29600,
					minFullInput: 20000,
					scaleStatus: "threshold_reached",
					crossSessionCachePossible: true,
					coldCacheGuaranteed: false,
				});
				expect(report.longHistory?.estimatedTokensProvenance).toContain("not tokenizer-measured");
				expect(report.requests.every((r) => r.fullInput === 29600)).toBe(true);
				expect(
					report.requests.every(
						(r) =>
							JSON.stringify(r.baseUserPartOrder) ===
							JSON.stringify(stage === "long-before" ? ["image_url", "text"] : ["text", "image_url"]),
					),
				).toBe(true);
				const serialized = JSON.stringify(report);
				for (const forbidden of [
					"Synthetic tile",
					"data:image",
					"authorization",
					"headers",
					"messages",
					sessions.at(-1) ?? "missing-session",
				])
					expect(serialized).not.toContain(forbidden);
			}
			runs.push(bodies);
		}
		expect(new Set(sessions).size).toBe(3);
		const [large, before, after] = runs;
		if (!large || !before || !after) throw new Error("missing runs");
		for (let i = 0; i < 8; i++) {
			const longBody = structuredClone(after[i] as Body);
			const parts = longBody.messages[1]?.content;
			const shortParts = large[i]?.messages[1]?.content;
			if (!Array.isArray(parts) || !Array.isArray(shortParts)) throw new Error("missing parts");
			expect(parts[0]?.text).toBe(Array(4).fill(shortParts[0]?.text).join("\n"));
			parts[0] = structuredClone(shortParts[0] as Part);
			expect(longBody).toEqual(large[i]); // All other wire fields and extensions unchanged.
			const reordered = structuredClone(after[i] as Body);
			const userParts = reordered.messages[1]?.content;
			if (!Array.isArray(userParts)) throw new Error("missing user parts");
			userParts.reverse();
			expect(reordered).toEqual(before[i]); // Only the two base-user parts change order.
		}
	});

	it.each(["long-before", "long-after"] as const)(
		"invalidates %s on first nonzero fullInput below threshold without retry",
		async (stage) => {
			for (const fullInput of [19999, 20000, 0]) {
				const mockFetch = vi.fn<FetchFunction>(() =>
					Promise.resolve(
						new Response(
							`data: ${JSON.stringify({ id: "synthetic", choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: fullInput, completion_tokens: 1, total_tokens: fullInput + 1, prompt_tokens_details: { cached_tokens: Math.floor(fullInput / 2) } } })}\n\ndata: [DONE]\n\n`,
							{ headers: { "content-type": "text/event-stream" } },
						),
					),
				);
				const report = await runProbe({ stage, mockFetch });
				expect(mockFetch).toHaveBeenCalledTimes(fullInput === 20000 ? 8 : 1);
				expect(report.success).toBe(fullInput === 20000);
				expect(report.requests[0]?.errorCode).toBe(
					fullInput === 19999 ? "usage_scale_not_reached" : fullInput === 0 ? "usage-unavailable" : null,
				);
				expect(report.longHistory?.scaleStatus).toBe(
					fullInput === 19999 ? "invalid_experiment" : fullInput === 0 ? "unverified" : "threshold_reached",
				);
				if (fullInput === 19999) {
					expect(report.requests[0]?.stopReason).toBe("stop");
					expect(report.requests[0]?.fullInput).toBe(19999);
					expect(report.requests[0]?.usage).not.toBeNull();
				}
			}
		},
	);

	it("reports changed old wire history without aborting, but rejects unstable repeats/config/images", async () => {
		const prototype = Object.getPrototypeOf(createModels()) as Models;
		const original = prototype.completeSimple;
		for (const change of ["prefix", "repeat", "config", "image"] as const) {
			let calls = 0;
			const spy = vi.spyOn(prototype, "completeSimple").mockImplementation(function (
				this: Models,
				model,
				context,
				options,
			) {
				const index = calls++;
				return original.call(this, model, context, {
					...options,
					onPayload: (payload, selected) => {
						const body = payload as Body;
						if ((change === "prefix" && index >= 2) || (change === "repeat" && index === 1))
							body.messages[0] = { role: "system", content: "Changed synthetic history" };
						if (change === "config" && index === 1) body.temperature = 1;
						if (change === "image" && index === 1)
							body.messages = body.messages.filter((m) => !Array.isArray(m.content));
						return options?.onPayload?.(body, selected);
					},
				});
			});
			try {
				const report = await runProbe();
				expect(report.success).toBe(change === "prefix");
				expect(calls).toBe(change === "prefix" ? 8 : 2);
				if (change === "prefix") expect(report.requests[2]?.oldPrefixEqual).toBe(false);
				else expect(report.requests[1]?.errorCode).toBe("payload-invariant");
			} finally {
				spy.mockRestore();
			}
		}
	});

	it("never retries a provider failure and never reports raw errors", async () => {
		const mockFetch = vi.fn<FetchFunction>(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: { message: "RAW_PRIVATE_ERROR", type: "server_error" } }), {
					status: 500,
				}),
			),
		);
		const report = await runProbe({ mockFetch });
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(report.success).toBe(false);
		expect(report.requests).toHaveLength(1);
		expect(report.requests[0]?.errorCode).toBe("provider-failed");
		expect(JSON.stringify(report)).not.toContain("RAW_PRIVATE_ERROR");
	});

	it("stops at the first successful response without usable usage", async () => {
		const mockFetch = vi.fn<FetchFunction>(() =>
			Promise.resolve(
				new Response(
					'data: {"id":"synthetic","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
					{ headers: { "content-type": "text/event-stream" } },
				),
			),
		);
		const report = await runProbe({ mockFetch });
		expect(mockFetch).toHaveBeenCalledTimes(1);
		expect(report.requests[0]?.errorCode).toBe("usage-unavailable");
	});

	it.each([
		["https://api.deepseek.com/v1", "deepseek", "deepseek-flash", false],
		["https://opencode.ai/zen/go/v1", "opencode-go", "deepseek-v4.1-flash", true],
		["https://custom.invalid/v1", "opencode-go", "deepseek-v4.1-flash", true],
	] as const)("mocks %s using its public provider and auth", async (baseUrl, provider, baseline, go) => {
		const headers: Headers[] = [];
		const bodies: Body[] = [];
		const report = await runProbe({
			env: { OPENAI_BASE_URL: baseUrl, OPENAI_API_KEY: "synthetic-route-key" },
			mockFetch: (input, init) => {
				expect(String(input)).toBe(`${baseUrl}/chat/completions`);
				headers.push(new Headers(init?.headers));
				bodies.push(JSON.parse(String(init?.body)) as Body);
				return offlineFetch(input, init);
			},
		});
		expect(report.mode).toBe("offline");
		expect(report.success).toBe(true);
		expect(report.config).toMatchObject({ provider, baseline, wireModel: "deepseek-flash", maxOutputTokens: 256 });
		const cliModels = createCliModels({ OPENAI_BASE_URL: baseUrl, OPENAI_API_KEY: "synthetic-route-key" });
		const cliModel = cliModels.getModel(provider, "deepseek-flash");
		if (!cliModel) throw new Error("missing CLI model");
		expect(report.config.api).toBe(cliModel.api);
		expect(report.config.originalModelMaxTokens).toBe(cliModel.maxTokens);
		expect(await cliModels.getAuth(cliModel)).toMatchObject({
			auth: { apiKey: "synthetic-route-key" },
			source: "OPENAI_API_KEY",
		});
		expect(headers).toHaveLength(8);
		for (const header of headers) {
			expect(header.get("authorization")).toBe("Bearer synthetic-route-key");
			if (go) expect(header.get("x-opencode-session")).toMatch(/^synthetic-vision-cache-/);
			else expect(header.get("x-opencode-session")).toBeNull();
		}
		expect(
			bodies.every((body) => body.model === "deepseek-flash" && body.max_tokens === 256 && body.temperature === 0),
		).toBe(true);
		expect(JSON.stringify(report)).not.toContain("synthetic-route-key");
	});

	it.each(["https://api.deepseek.com/v1", "https://opencode.ai/zen/go/v1"])(
		"rejects old key only at %s without a request",
		async (OPENAI_BASE_URL) => {
			const mockFetch = vi.fn<FetchFunction>(offlineFetch);
			await expect(
				runProbe({ env: { OPENAI_BASE_URL, OPENCODE_API_KEY: "synthetic-old-key" }, mockFetch }),
			).rejects.toThrow("missing-auth");
			expect(mockFetch).not.toHaveBeenCalled();
		},
	);

	it("rejects transport injection in live mode before auth/network", async () => {
		await expect(runProbe({ live: true, mockFetch: offlineFetch })).rejects.toThrow("live-transport-override");
	});

	it.each(["large", "tool", "reasoning", "long-before", "long-after"] as const)(
		"runs --stage=%s offline through the executable",
		(stage) => {
			const output = execFileSync(process.execPath, ["scripts/probe-vision-cache.mjs", `--stage=${stage}`], {
				encoding: "utf8",
			});
			const report = JSON.parse(output) as { stage: string; mode: string; success: boolean; requests: unknown[] };
			expect(report.stage).toBe(stage);
			expect(report.mode).toBe("offline");
			expect(report.success).toBe(true);
			expect(report.requests).toHaveLength(8);
		},
	);

	it("rejects invalid stages before making any request", async () => {
		const mockFetch = vi.fn<FetchFunction>(offlineFetch);
		await expect(runProbe({ stage: "unknown" as "large", mockFetch })).rejects.toThrow("invalid-stage");
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("defaults the executable to offline even with ambient live configuration", () => {
		const output = execFileSync(process.execPath, ["scripts/probe-vision-cache.mjs"], {
			encoding: "utf8",
			env: {
				...process.env,
				OPENAI_BASE_URL: "https://must-not-contact.invalid",
				OPENAI_API_KEY: "ambient-test-not-a-credential",
			},
		});
		const report = JSON.parse(output) as { mode: string; success: boolean; requests: unknown[] };
		expect(report.mode).toBe("offline");
		expect(report.success).toBe(true);
		expect(report.requests).toHaveLength(8);
		expect(output).not.toContain("ambient-test-not-a-credential");
	});
});
