/** Offline only: public harness + public provider with explicit mocked fetch. */
import { AgentHarness, MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { describe, expect, it, vi } from "vitest";
import { installModelRequestMetrics } from "../../src/composition/model-request-metrics.js";
import type { PiToolEvidence } from "../../src/composition/pi-tools.js";
import { installRequestPrefixMetrics } from "../../src/composition/request-prefix-metrics.js";

type Payload = Record<string, unknown>;
function evidence() {
	const records: { eventType: string; payload: Payload; recordedAt: string }[] = [];
	const store: PiToolEvidence = {
		readRuntime: async () => [],
		appendRuntime: (eventType, recordedAt, payload) => {
			records.push({ eventType, payload, recordedAt });
			return Promise.resolve({
				schema: "pi-arc.runtime-record.v1",
				sequence: records.length,
				eventType,
				recordedAt,
				payload,
			});
		},
	};
	return { records, store };
}
const now = () => "2026-10-09T00:00:00Z";
function observer() {
	const { records, store } = evidence();
	const callbacks = new Map<string, (event: { payload?: unknown }) => Promise<undefined>>();
	const harness = {
		hooks: {
			on: (name: string, callback: (event: { payload?: unknown }) => Promise<undefined>) =>
				callbacks.set(name, callback),
		},
	} as unknown as Pick<AgentHarness<undefined>, "hooks">;
	const metrics = installRequestPrefixMetrics(harness, store, now, { currentRequestId: () => "shared-id" });
	return {
		...metrics,
		records,
		observe: async (payload: unknown) => {
			const original = JSON.stringify(payload);
			expect(await callbacks.get("before_payload")?.({ payload })).toBeUndefined();
			expect(JSON.stringify(payload)).toBe(original);
			return records.at(-1)?.payload;
		},
		respond: () => callbacks.get("after_response")?.({}),
	};
}
const user = (content: string) => ({ role: "user", content });
const chat = (messages: unknown[], extra: Payload = {}) => ({ model: "synthetic-model", messages, ...extra });

describe("safe serialization-boundary prefix metadata", () => {
	it("detects append, identical retry, mutation, reorder, truncation and explicit fresh root", async () => {
		const diagnostic = observer();
		const a = user("private-a");
		const b = user("private-b");
		expect(await diagnostic.observe(chat([a]))).toMatchObject({ appendOnly: null, previousMessageCount: 0 });
		const appended = await diagnostic.observe(chat([a, b]));
		expect(appended).toMatchObject({ appendOnly: true, prefixMessageCount: 1, firstChangedIndex: null });
		const retry = await diagnostic.observe(chat([a, b]));
		expect(retry).toMatchObject({
			appendOnly: true,
			prefixMessageCount: 2,
			systemStable: true,
			toolsStable: true,
			optionsStable: true,
		});
		expect(retry?.messageChainHash).toBe(appended?.messageChainHash);
		expect(await diagnostic.observe(chat([a, user("private-mutated")]))).toMatchObject({
			appendOnly: false,
			firstChangedIndex: 1,
			firstChangedRole: "user",
		});
		expect(await diagnostic.observe(chat([b, a]))).toMatchObject({ appendOnly: false, firstChangedIndex: 0 });
		expect(await diagnostic.observe(chat([b]))).toMatchObject({
			appendOnly: false,
			firstChangedIndex: 1,
			firstChangedRole: "user",
		});
		diagnostic.resetContext();
		expect(await diagnostic.observe(chat([a]))).toMatchObject({
			segment: 2,
			appendOnly: null,
			previousMessageCount: 0,
		});
		await diagnostic.respond();
		expect(diagnostic.records.at(-1)).toMatchObject({
			eventType: "model.responded",
			payload: { phase: "request_prefix", requestId: "shared-id", segment: 2 },
		});
		expect(JSON.stringify(diagnostic.records)).not.toContain("private-");
	});

	it("fingerprints system, tools, safe options, images and reasoning without exporting individual digests", async () => {
		const diagnostic = observer();
		const messages = [
			{ role: "system", content: "private-system" },
			{
				role: "assistant",
				reasoning_content: "private-reasoning",
				content: [{ type: "image_url", image_url: { url: "data:image/png;base64,private-image" } }],
				tool_calls: [
					{
						id: "private-call",
						type: "function",
						function: { name: "play", arguments: '{"token":"private-secret"}' },
					},
				],
			},
		];
		const first = await diagnostic.observe(
			chat(messages, { temperature: 0, tools: [{ type: "function", function: { name: "play", parameters: {} } }] }),
		);
		const second = await diagnostic.observe(
			chat(messages, { temperature: 1, tools: [{ type: "function", function: { name: "play", parameters: {} } }] }),
		);
		expect(second).toMatchObject({
			actualImageCount: 1,
			optionsStable: false,
			systemStable: true,
			toolsStable: true,
		});
		expect(second?.imageHash).toBe(first?.imageHash);
		const third = await diagnostic.observe(
			chat(
				[
					{ role: "system", content: "changed" },
					{
						...messages[1],
						reasoning_content: "changed",
						content: [{ type: "image_url", image_url: { url: "changed" } }],
					},
				],
				{ tools: [] },
			),
		);
		expect(third).toMatchObject({ systemStable: false, toolsStable: false, firstChangedIndex: 0 });
		expect(third?.imageHash).not.toBe(first?.imageHash);
		expect(third?.reasoningHash).not.toBe(first?.reasoningHash);
		const exported = JSON.stringify(diagnostic.records);
		for (const forbidden of ["private-", "tool_calls", "arguments", "reasoning_content", "image_url"])
			expect(exported).not.toContain(forbidden);
		expect(first?.prefixBytes).toBe(0);
		expect(second?.prefixBytes).toBe(
			messages.reduce((sum, message) => sum + Buffer.byteLength(JSON.stringify(message)), 0),
		);
	});

	it("supports Responses input items and instructions explicitly", async () => {
		const diagnostic = observer();
		const input = [
			{ type: "message", role: "user", content: [{ type: "input_image", image_url: "private-image" }] },
			{ type: "reasoning", id: "r", summary: [{ type: "summary_text", text: "private-thinking" }] },
			{ type: "function_call", call_id: "c", name: "play", arguments: "private-args" },
		];
		const first = await diagnostic.observe({
			model: "model",
			input,
			instructions: "private-system",
			reasoning: { effort: "high" },
		});
		expect(first).toMatchObject({
			format: "responses",
			unsupported: false,
			actualImageCount: 1,
			currentMessageCount: 3,
		});
		expect(
			await diagnostic.observe({
				model: "model",
				input: [...input, { type: "function_call_output", call_id: "c", output: "private-result" }],
				instructions: "private-system",
				reasoning: { effort: "low" },
			}),
		).toMatchObject({ appendOnly: true, prefixMessageCount: 3, optionsStable: false });
		expect(JSON.stringify(diagnostic.records)).not.toContain("private-");
	});

	it("excludes metadata/auth/header/private fields; unknown formats invalidate comparison", async () => {
		const diagnostic = observer();
		const first = await diagnostic.observe(
			chat([user("safe")], {
				metadata: { secret: "private-a" },
				headers: { Authorization: "private-b" },
				apiKey: "private-c",
				extra_body: { password: "private-d" },
			}),
		);
		const second = await diagnostic.observe(
			chat([user("safe")], { metadata: { secret: "changed" }, headers: {}, apiKey: "changed" }),
		);
		expect(second?.optionsHash).toBe(first?.optionsHash);
		expect(await diagnostic.observe({ private: "private-unsupported", input: "private-text" })).toMatchObject({
			unsupported: true,
		});
		expect(await diagnostic.observe(chat([{ role: "user", content: "safe", private: "secret" }]))).toMatchObject({
			unsupported: true,
		});
		expect(await diagnostic.observe(chat([user("safe")]))).toMatchObject({ appendOnly: null });
		expect(JSON.stringify(diagnostic.records)).not.toMatch(/private-|Authorization|apiKey|extra_body|password/);
	});

	it("contains diagnostic errors and caps digest state independent of multiMB content", async () => {
		const diagnostic = observer();
		const content = "x".repeat(2_000_000);
		await diagnostic.observe(chat([user(content)]));
		const retry = await diagnostic.observe(chat([user(content)]));
		expect(retry).toMatchObject({ appendOnly: true, prefixMessageCount: 1 });
		expect(JSON.stringify(diagnostic.records).length).toBeLessThan(5000);
		expect(await diagnostic.observe(chat(Array.from({ length: 8193 }, () => user("x"))))).toMatchObject({
			unsupported: true,
		});
		const cyclic: Payload = {};
		cyclic.self = cyclic;
		const callbacks = new Map<string, (event: { payload?: unknown }) => Promise<undefined>>();
		const harness = {
			hooks: {
				on: (name: string, callback: (event: { payload?: unknown }) => Promise<undefined>) =>
					callbacks.set(name, callback),
			},
		} as unknown as Pick<AgentHarness<undefined>, "hooks">;
		const { store } = evidence();
		installRequestPrefixMetrics(
			harness,
			{ ...store, appendRuntime: () => Promise.reject(new Error("private-error")) },
			now,
			{ currentRequestId: () => null },
		);
		expect(
			await callbacks.get("before_payload")?.({ payload: chat([user("safe")], { tools: cyclic }) }),
		).toBeUndefined();
		expect(await callbacks.get("after_response")?.({})).toBeUndefined();
	});

	it("observes the actual public provider wire after transforms, never rewriting or performing HTTP", async () => {
		const fallback = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
			throw new Error("unexpected network");
		});
		const real = opencodeGoProvider();
		const baseline = real.getModels().find((candidate) => candidate.id === "deepseek-v4.1-flash");
		if (!baseline) throw new Error("missing public baseline");
		const model = { ...baseline, id: "deepseek-flash", baseUrl: "https://diagnostic.invalid/v1" };
		const wire: Payload[] = [];
		const hookPayloads: string[] = [];
		const models = createModels({
			authContext: {
				env: async (name) => (name === "OPENCODE_API_KEY" ? "synthetic-not-real" : undefined),
				fileExists: async () => false,
			},
		});
		models.setProvider({
			...real,
			getModels: () => [model],
			streamSimple: (_selected, context, options) =>
				real.streamSimple(model, context, {
					...options,
					apiKey: "synthetic-not-real",
					env: {},
					maxRetries: 1,
					fetch: (url, init) => {
						expect(new URL(String(url)).hostname).toBe("diagnostic.invalid");
						if (typeof init?.body !== "string") throw new Error("unexpected body");
						wire.push(JSON.parse(init.body) as Payload);
						if (wire.length === 1)
							return Promise.resolve(
								new Response("synthetic retry", { status: 503, headers: { "retry-after": "0" } }),
							);
						return Promise.resolve(
							new Response(
								'data: {"id":"mock","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
								{ headers: { "content-type": "text/event-stream" } },
							),
						);
					},
				}),
		});
		const repo = new MemorySessionRepo();
		const session = await repo.create({}, TODO_CONTEXT);
		const { harness } = await AgentHarness.create(
			{
				session,
				models,
				model,
				systemPrompt: "private-system",
				compaction: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 },
			},
			TODO_CONTEXT,
		);
		const { records, store } = evidence();
		harness.hooks.on("transform_context", ({ messages }) => ({
			messages: messages.map((message) =>
				message.role === "user"
					? {
							...message,
							content: [
								{ type: "text" as const, text: "private-transformed" },
								{ type: "image" as const, data: "AA==", mimeType: "image/png" },
							],
						}
					: message,
			),
		}));
		harness.hooks.on("before_payload", ({ payload }) => {
			hookPayloads.push(JSON.stringify(payload));
			return undefined;
		});
		const correlation = installModelRequestMetrics(harness, store, now);
		const diagnostic = installRequestPrefixMetrics(harness, store, now, correlation);
		try {
			const lane = await harness.lane("main", TODO_CONTEXT);
			await lane.prompt("private-original", undefined, TODO_CONTEXT);
			await lane.prompt("private-next", undefined, TODO_CONTEXT);
			expect(wire).toHaveLength(3);
			expect(wire[0]).toEqual(wire[1]); // transport replay uses the same serialized body
			expect(wire.slice(1).map((payload) => JSON.stringify(payload))).toEqual(hookPayloads);
			const requests = records.filter(
				(record) => record.eventType === "model.requested" && record.payload.phase === "request_prefix",
			);
			expect(requests).toHaveLength(2);
			expect(requests[1]?.payload).toMatchObject({
				unsupported: false,
				appendOnly: true,
				actualImageCount: 2,
				systemStable: true,
				toolsStable: true,
				optionsStable: true,
			});
			for (const request of requests)
				expect(
					records.some(
						(record) =>
							record.payload.phase === "provider_request" &&
							record.payload.requestId === request.payload.requestId,
					),
				).toBe(true);
			const root = await lane.navigateTree(null, { summarize: false }, TODO_CONTEXT);
			expect(root.ok).toBe(true);
			diagnostic.resetContext();
			await lane.prompt("private-fresh", undefined, TODO_CONTEXT);
			expect(
				records
					.filter((record) => record.payload.phase === "request_prefix" && record.eventType === "model.requested")
					.at(-1)?.payload,
			).toMatchObject({ segment: 2, previousMessageCount: 0, appendOnly: null });
			expect(JSON.stringify(records)).not.toContain("private-");
			expect(fallback).not.toHaveBeenCalled();
		} finally {
			await harness.close(TODO_CONTEXT);
			await repo.close(TODO_CONTEXT);
			fallback.mockRestore();
		}
	});
});
