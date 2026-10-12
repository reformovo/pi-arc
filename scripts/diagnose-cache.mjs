/** Offline only: historic content/payloads remain in memory; stdout is numeric metadata only.
 * Run: npm run build && node scripts/diagnose-cache.mjs /absolute/pi-session
 * Public Models API and real provider serialization; no onPayload edits or private imports.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { MODEL_TOOL_DEFINITIONS } from "../dist/application/model-prompts.js";
import { boundVisualContext } from "../dist/composition/visual-context.js";

/** @typedef {import('@earendil-works/pi-ai').Message} Message */
/** @typedef {import('@earendil-works/pi-ai').Usage} Usage */
/** @typedef {import('@earendil-works/pi-ai').ThinkingLevel} ThinkingLevel */
/** @typedef {{ kind: string, type: string, id: string, parentId: string | null, timestamp: number, message: Message, namespace: string, value: { thinkingLevel?: ThinkingLevel } }} SessionEntry */
/** @typedef {{ eventType: string, recordedAt: string, payload: { usage: Usage & { reasoning?: number }, requestId: string, imageCount: number, durationMs: number, phase?: string, reason?: string, turn: number } }} RuntimeEntry */
/** @typedef {{ [key: string]: unknown, role?: string, reasoning_content?: string }} WireMessage */
/** @typedef {{ messages: WireMessage[], thinking?: unknown, reasoning_effort?: unknown, [key: string]: unknown }} WirePayload */
/** @typedef {{ bodyKeys: string[], headerNames: string[], sessionIdInBody: boolean, sessionIdInHeaders: boolean, thinking: unknown, reasoningEffort: unknown, promptCacheKeyPresent: boolean }} WireShape */
/** @typedef {{ request: number, segment: number, segmentRequest: number, entryTimestamp: number, messageTimestamp: number, usage: Record<string, number>, runtime: { usageMatchCandidates: number, responseTimestamp: string, requestTimestamp: string | null, responseMinusEntryMs: number, imageCount: number, durationMs: number, reasoning: number | null } | null, ancestorAppend: boolean, previousRequestInSegment: number | null, sourceImmutable: boolean, historyMessages: number, images: number, retainedImages: number, fullInput: number, uncachedInput: number, cacheRead: number, cacheWrite: number, cacheFraction: number, thinkingBytes: number, wireThinkingBytes: number, raw: ReturnType<typeof compare> | null, bound64: ReturnType<typeof compare> | null, projection: ReturnType<typeof compare> }} Row */

// Prevent accidental fallback networking. Explicit per-request fetch below captures in memory.
/** @param {string | URL | Request} _input @param {RequestInit} [_init] @returns {Promise<Response>} */
function blockedFetch(_input, _init) {
	return Promise.reject(new Error("network disabled by diagnostic"));
}
globalThis.fetch = blockedFetch;
/** @param {string} root @returns {string[]} */
function files(root) {
	return statSync(root).isFile() ? [root] : readdirSync(root).flatMap((name) => files(join(root, name)));
}
/** @param {unknown} value @returns {unknown[]} */
function flatten(value) {
	return Array.isArray(value) ? value.flatMap(flatten) : [value];
}
/** @param {unknown} value */
function bytes(value) {
	return Buffer.from(JSON.stringify(value));
}
/** @param {Buffer} a @param {Buffer} b */
function lcp(a, b) {
	let i = 0;
	while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
	return i;
}
/** @param {Message[]} messages */
function imageCount(messages) {
	return messages.reduce(
		(n, m) => n + (Array.isArray(m.content) ? m.content.filter((p) => p.type === "image").length : 0),
		0,
	);
}
// Newline-delimited normalized wire messages exclude array closing punctuation; proxy is bytes/4,
// NOT model tokens, especially for base64 PNGs. Nothing here claims an exact cache boundary.
/** @param {WireMessage[]} a @param {WireMessage[]} b */
function compare(a, b) {
	const x = Buffer.from(a.map((m) => JSON.stringify(m)).join("\n"));
	const y = Buffer.from(b.map((m) => JSON.stringify(m)).join("\n"));
	const commonBytes = lcp(x, y);
	let first = 0;
	while (first < Math.min(a.length, b.length) && bytes(a[first]).equals(bytes(b[first]))) first++;
	const previousMessage = a[first];
	const currentMessage = b[first];
	const mutation = first < a.length;
	assert(!mutation || previousMessage);
	const changedKeys = mutation
		? [...new Set([...Object.keys(previousMessage ?? {}), ...Object.keys(b[first] ?? {})])].filter(
				(k) => JSON.stringify(previousMessage?.[k]) !== JSON.stringify(currentMessage?.[k]),
			)
		: [];
	/** @param {WireMessage[]} ms */
	const textOnly = (ms) =>
		Buffer.from(
			JSON.stringify(ms, (key, value) =>
				key === "url" && typeof value === "string" && value.startsWith("data:image/")
					? "[image bytes excluded]"
					: value,
			),
		);
	const textCommon = lcp(textOnly(a), textOnly(b));
	return {
		previousBytes: x.length,
		currentBytes: y.length,
		commonBytes,
		commonByteQuarterProxy: commonBytes / 4,
		imageDataExcludedCommonBytes: textCommon,
		imageDataExcludedByteQuarterProxy: textCommon / 4,
		firstChangedMessage: mutation ? first : null,
		previousRole: mutation ? previousMessage?.role : null,
		currentRole: mutation ? (b[first]?.role ?? null) : null,
		changedKeys,
		sharedMessages: first,
	};
}

async function main() {
	assert(process.argv[2], "Provide a historic session directory or JSONL file");
	const paths = files(process.argv[2]).filter((p) => p.endsWith(".jsonl"));
	assert.equal(paths.length, 1, "Expected exactly one session; select a file otherwise");
	assert(paths[0]);
	const entries = /** @type {SessionEntry[]} */ (
		readFileSync(paths[0], "utf8")
			.trim()
			.split("\n")
			.flatMap((line) => flatten(/** @type {unknown} */ (JSON.parse(line))))
	);
	const messageEntries = entries.filter((e) => e.kind === "entry" && e.type === "message");
	const byId = new Map(messageEntries.map((e) => [e.id, e]));
	assert.equal(byId.size, messageEntries.length, "Duplicate entry IDs");
	/** @param {SessionEntry} entry @returns {SessionEntry[]} */
	function ancestors(entry) {
		/** @type {SessionEntry[]} */
		const path = [];
		const seen = new Set([entry.id]);
		let id = entry.parentId;
		while (id !== null) {
			assert(!seen.has(id), "Cyclic branch");
			seen.add(id);
			const parent = byId.get(id);
			assert(parent, "Missing branch parent");
			path.push(parent);
			id = parent.parentId;
		}
		return path.reverse();
	}
	const roots = messageEntries.filter((e) => e.parentId === null);
	const segmentByRoot = new Map(roots.map((e, i) => [e.id, i + 1]));
	const runtime = /** @type {RuntimeEntry[]} */ (
		process.argv[3]
			? readFileSync(process.argv[3], "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line))
			: []
	);
	const runtimeResponses = runtime.filter((e) => e.eventType === "model.responded" && e.payload?.usage);
	const runtimeRequests = new Map(
		runtime
			.filter((e) => e.eventType === "model.requested" && e.payload?.requestId)
			.map((e) => [e.payload.requestId, e]),
	);
	const usedRuntime = new Set();
	assert(
		entries.filter((e) => e.kind === "entry").every((e) => e.type === "message"),
		"Nonmessage entries need context reconstruction",
	);
	const config = entries.find((e) => e.namespace === "pi.lane.config")?.value;
	const messages = messageEntries.map((e) => e.message); // Counts only; never sliced for replay.
	const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
	const provider = opencodeGoProvider();
	models.setProvider(provider);
	const baseline = models.getModel("opencode-go", "deepseek-v4.1-flash");
	assert(baseline, "Required catalog model missing");
	// Alias/capabilities match cli-models.ts. .invalid plus mocked fetch guarantees no provider contact.
	const model = { ...baseline, id: "deepseek-flash", baseUrl: "https://diagnostic.invalid/v1" };
	const tools = MODEL_TOOL_DEFINITIONS.map((d) => ({
		name: d.name,
		description: d.description,
		parameters: d.inputSchema,
	}));

	let fetches = 0;
	/** @type {WireShape | undefined} */
	let wireShape;
	/** @param {Message[]} history */
	async function wire(history) {
		// A holder keeps callback assignment visible to checked JavaScript control flow.
		/** @type {{ payload?: WirePayload }} */
		const captured = {};
		await models.completeSimple(
			model,
			{
				// Historic session doesn't persist system prompt/tool schemas. Stable diagnostic sentinel
				// and current public tool definitions isolate history effects; not a full historic request.
				systemPrompt: "Stable offline diagnostic system prompt.",
				messages: history,
				tools,
			},
			{
				apiKey: "synthetic-diagnostic-key",
				sessionId: "synthetic-diagnostic-session",
				env: {},
				reasoning: config?.thinkingLevel ?? "high",
				maxRetries: 0,
				fetch: (_url, init) => {
					fetches++;
					assert(typeof init?.body === "string");
					const payload = /** @type {WirePayload} */ (JSON.parse(init.body));
					captured.payload = payload;
					if (!wireShape) {
						const headers = new Headers(init?.headers);
						wireShape = {
							bodyKeys: Object.keys(payload),
							headerNames: [...headers.keys()],
							sessionIdInBody: JSON.stringify(payload).includes("synthetic-diagnostic-session"),
							sessionIdInHeaders: [...headers.values()].some((v) => v.includes("synthetic-diagnostic-session")),
							thinking: payload.thinking,
							reasoningEffort: payload.reasoning_effort,
							promptCacheKeyPresent: "prompt_cache_key" in payload,
						};
					}
					return Promise.resolve(
						new Response(
							'data: {"id":"offline","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
							{ status: 200, headers: { "content-type": "text/event-stream" } },
						),
					);
				},
			},
		);
		assert(captured.payload, "Provider did not serialize a request");
		return captured.payload.messages;
	}
	/** @type {Row[]} */
	const rows = [];
	/** @type {Map<number, { raw: WireMessage[]; bound: WireMessage[]; ids: string[]; request: number }>} */
	const previousBySegment = new Map();
	let request = 0;
	let totalThinkingBytes = 0;
	let retainedThinkingBytes = 0;
	for (let i = 0; i < messages.length; i++) {
		const response = messages[i];
		assert(response);
		if (response.role !== "assistant") continue;
		request++;
		const entry = messageEntries[i];
		assert(entry);
		const path = ancestors(entry);
		const segment = segmentByRoot.get((path[0] ?? entry).id);
		assert(segment, "Unknown segment root");
		const history = path.map((e) => e.message);
		const before = bytes(history);
		// Projection only replaces content inside these public Message variants.
		const projected = /** @type {Message[]} */ (boundVisualContext(history, 64));
		const raw = await wire(history);
		const bounded = await wire(projected);
		assert(before.equals(bytes(history)), "Projection/serialization mutated source history");
		const previous = previousBySegment.get(segment);
		const ids = path.map((e) => e.id);
		const ancestorAppend = !previous || previous.ids.every((id, j) => ids[j] === id);
		const thinkingBlocks = history.flatMap((m) =>
			m.role === "assistant" ? m.content.filter((p) => p.type === "thinking") : [],
		);
		const sourceThinking = thinkingBlocks.reduce((n, p) => n + Buffer.byteLength(p.thinking), 0);
		const wireThinking = bounded.reduce(
			(n, m) => n + (typeof m.reasoning_content === "string" ? Buffer.byteLength(m.reasoning_content) : 0),
			0,
		);
		totalThinkingBytes = sourceThinking;
		retainedThinkingBytes = wireThinking;
		const usage = response.usage;
		/** @type {(keyof Usage)[]} */
		const usageKeys = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
		const candidates = runtimeResponses
			.map((e, index) => ({ e, index }))
			.filter(({ e, index }) => !usedRuntime.has(index) && usageKeys.every((k) => e.payload.usage[k] === usage[k]));
		candidates.sort(
			(a, b) =>
				Math.abs(Date.parse(a.e.recordedAt) - entry.timestamp) -
				Math.abs(Date.parse(b.e.recordedAt) - entry.timestamp),
		);
		const match = candidates[0];
		if (match) usedRuntime.add(match.index);
		const runtimeRequest = match ? runtimeRequests.get(match.e.payload.requestId) : undefined;
		rows.push({
			request,
			segment,
			segmentRequest: rows.filter((r) => r.segment === segment).length + 1,
			entryTimestamp: entry.timestamp,
			messageTimestamp: response.timestamp,
			usage: Object.fromEntries(Object.entries(usage).filter(([, value]) => typeof value === "number")),
			runtime: match
				? {
						usageMatchCandidates: candidates.length,
						responseTimestamp: match.e.recordedAt,
						requestTimestamp: runtimeRequest?.recordedAt ?? null,
						responseMinusEntryMs: Date.parse(match.e.recordedAt) - entry.timestamp,
						imageCount: match.e.payload.imageCount,
						durationMs: match.e.payload.durationMs,
						reasoning: match.e.payload.usage.reasoning ?? null,
					}
				: null,
			ancestorAppend,
			previousRequestInSegment: previous?.request ?? null,
			sourceImmutable: true,
			historyMessages: history.length,
			images: imageCount(history),
			retainedImages: imageCount(projected),
			fullInput: usage.input + usage.cacheRead + usage.cacheWrite,
			uncachedInput: usage.input,
			cacheRead: usage.cacheRead,
			cacheWrite: usage.cacheWrite,
			cacheFraction: usage.cacheRead / (usage.input + usage.cacheRead + usage.cacheWrite),
			thinkingBytes: sourceThinking,
			wireThinkingBytes: wireThinking,
			raw: previous ? compare(previous.raw, raw) : null,
			bound64: previous ? compare(previous.bound, bounded) : null,
			projection: compare(raw, bounded),
		});
		previousBySegment.set(segment, { raw, bound: bounded, ids: [...ids, entry.id], request });
	}
	const overflow = rows.find((r) => r.images > 64)?.request;
	const representative = new Set([
		1,
		2,
		10,
		30,
		64,
		65,
		100,
		101,
		150,
		request,
		...(overflow ? [overflow - 1, overflow, overflow + 1] : []),
	]);
	const worst = [...rows]
		.sort((a, b) => a.cacheFraction - b.cacheFraction)
		.slice(0, 8)
		.map((r) => r.request);
	for (const n of worst) representative.add(n);
	const segments = roots.map((root, i) => {
		const rs = rows.filter((r) => r.segment === i + 1);
		const fullInput = rs.reduce((n, r) => n + r.fullInput, 0);
		const cacheRead = rs.reduce((n, r) => n + r.cacheRead, 0);
		return {
			segment: i + 1,
			rootTimestamp: root.timestamp,
			requests: rs.length,
			firstRequest: rs[0]?.request ?? null,
			lastRequest: rs.at(-1)?.request ?? null,
			fullInput,
			uncachedInput: rs.reduce((n, r) => n + r.uncachedInput, 0),
			cacheRead,
			cacheWrite: rs.reduce((n, r) => n + r.cacheWrite, 0),
			cacheFraction: fullInput ? cacheRead / fullInput : null,
			maxImages: Math.max(0, ...rs.map((r) => r.images)),
			nonappendRequests: rs.filter((r) => !r.ancestorAppend).map((r) => r.request),
			rawMutationRequests: rs.filter((r) => r.raw?.firstChangedMessage != null).map((r) => r.request),
			boundMutationRequests: rs.filter((r) => r.bound64?.firstChangedMessage != null).map((r) => r.request),
			thinkingPreserved: rs.every((r) => r.thinkingBytes === r.wireThinkingBytes),
			sourceImmutable: rs.every((r) => r.sourceImmutable),
		};
	});
	console.log(
		JSON.stringify(
			{
				methodology:
					"ParentId-walk PRE-request branches, consecutive comparisons within root segment only; public Models normalized provider wire; synthetic auth/session, .invalid endpoint and blocked global fetch; raw content only in memory. Fixed diagnostic system and current tool schemas are not historic full payload. Bytes/4 is not tokenizer output.",
				messageCounts: {
					total: messages.length,
					assistant: messages.filter((m) => m.role === "assistant").length,
					toolResult: messages.filter((m) => m.role === "toolResult").length,
					user: messages.filter((m) => m.role === "user").length,
				},
				segments,
				nonappendStorageEntries: messageEntries
					.map((e, i) => ({ e, i }))
					.filter(({ e, i }) => i > 0 && e.parentId !== messageEntries[i - 1]?.id)
					.map(({ e, i }) => ({
						entryIndex: i,
						root: e.parentId === null,
						role: e.message.role,
						timestamp: e.timestamp,
					})),
				runtimeCorrelation: {
					supplied: Boolean(process.argv[3]),
					responses: runtimeResponses.length,
					matched: usedRuntime.size,
					boundaries: runtime
						.filter((e) => e.eventType === "context.boundary")
						.map((e) => ({
							timestamp: e.recordedAt,
							phase: e.payload.phase ?? null,
							reason: e.payload.reason ?? null,
							turn: e.payload.turn,
						})),
				},
				limitation:
					"Partial history reconstruction, not original requests: historic system/tools, runtime transforms, retry/checkpoint attempts absent from successful session entries, model tokenizer and provider cache state are not replayed. Timestamp/usage correlation is not proof of exact payload identity.",
				requests: request,
				fetches,
				firstRequestOver64Images: overflow ?? null,
				wireShape,
				thinkingAtLastRequest: { sourceBytes: totalThinkingBytes, retainedWireBytes: retainedThinkingBytes },
				mutationRequests: {
					raw: rows.filter((r) => r.raw?.firstChangedMessage !== null && r.raw !== null).map((r) => r.request),
					bound64: rows
						.filter((r) => r.bound64?.firstChangedMessage !== null && r.bound64 !== null)
						.map((r) => r.request),
				},
				representative: rows.filter((r) => representative.has(r.request)),
				// All rows allow investigating cache drops without any transcript, args, image data or credentials.
				usageAndPrefix: rows.map(({ projection, ...row }) => row),
			},
			null,
			2,
		),
	);
}
main().catch(() => {
	console.error("Diagnostic failed; raw error suppressed to avoid content disclosure.");
	process.exitCode = 1;
});
