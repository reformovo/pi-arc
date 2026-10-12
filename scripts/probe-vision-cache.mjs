#!/usr/bin/env node
/** Synthetic, standalone public-pi-ai cache experiment. Default is strictly offline.
 * Live: node --env-file=.env scripts/probe-vision-cache.mjs --live --artifacts-root=run-artifacts
 * Never logs provider exceptions, outputs, payloads, headers, endpoint, or auth.
 */
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { syntheticPng1024 } from "./synthetic-probe-png.mjs";

/** @typedef {'tiny' | 'large' | 'tool' | 'reasoning' | 'long-before' | 'long-after'} Stage */

/** @typedef {import('@earendil-works/pi-ai').Context} Context */
/** @typedef {import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>} Model */
/** @typedef {import('@earendil-works/pi-ai').FetchFunction} FetchFunction */
/** @typedef {{ input: number, output: number, cacheRead: number, cacheWrite: number, totalTokens: number }} SafeUsage */
/** @typedef {{ label: string, durationMs: number, stopReason: string, usage: SafeUsage | null, errorCode: string | null, imageCount: number, messageCount: number, payloadHmac: string, oldPrefixEqual: boolean, repeatEqual: boolean | null, configStable: boolean, baseUserPartOrder?: string[], fullInput?: number }} RequestRecord */

// Two generated, CRC-valid 2x2 RGB PNGs: solid red and solid blue. No external assets.
const IMAGE_A = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==";
const IMAGE_B = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgYPgPRmAKABf2A/1+6zfzAAAAAElFTkSuQmCC";
const LONG_THINKING = "Synthetic reasoning: amber blue green. ".repeat(1800);
const SYSTEM = "This is a synthetic cache experiment. Reply only OK. Do not call tools.";
const TEXT = Array.from(
	{ length: 360 },
	(_, i) => `Synthetic tile ${i}: amber circles, blue squares, green triangles; all coordinates are imaginary.`,
).join("\n");
// Four copies of ordinary user text, not synthetic reasoning_content. The names
// describe the image's position relative to the text.
const LONG_TEXT = Array(4).fill(TEXT).join("\n");
const MIN_LONG_FULL_INPUT = 20_000;
const STAGES = ["tiny", "large", "tool", "reasoning", "long-before", "long-after"];
const LABELS = [
	"base",
	"base-repeat",
	"text-extension",
	"text-repeat",
	"same-image-extension",
	"same-image-repeat",
	"new-image-extension",
	"new-image-repeat",
];
const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** @param {Model} model @param {number} index @param {Stage} stage @param {string[]} images @returns {Context} */
function contextFor(model, index, stage, images) {
	const long = stage === "long-before" || stage === "long-after";
	/** @type {import('@earendil-works/pi-ai').UserMessage['content']} */
	const baseContent = [
		{ type: "text", text: long ? LONG_TEXT : TEXT },
		{ type: "image", data: images[0] ?? IMAGE_A, mimeType: "image/png" },
	];
	if (stage === "long-before") baseContent.reverse();
	/** @type {Context['messages']} */
	const messages = [
		{
			role: "user",
			content: baseContent,
			timestamp: 0,
		},
	];
	if (index >= 2) {
		messages.push({
			role: "assistant",
			content: [{ type: "text", text: "OK" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: ZERO_USAGE,
			stopReason: "stop",
			timestamp: 0,
		});
		/** @type {import('@earendil-works/pi-ai').UserMessage['content']} */
		const content = [{ type: "text", text: "Synthetic extension: reply OK again." }];
		if (index >= 4)
			content.push({ type: "image", data: images[index >= 6 ? 1 : 0] ?? IMAGE_A, mimeType: "image/png" });
		messages.push({ role: "user", content, timestamp: 0 });
	}
	if (stage === "tool" || stage === "reasoning") {
		/** @type {Context['messages']} */
		const toolMessages = [];
		for (const message of messages) {
			if (message.role !== "user") {
				toolMessages.push(message);
				continue;
			}
			const id = toolMessages.length === 0 ? "synthetic_base" : "synthetic_extension";
			toolMessages.push({
				role: "assistant",
				content: [
					...(stage === "reasoning" && id === "synthetic_base"
						? [
								{
									type: /** @type {const} */ ("thinking"),
									thinking: LONG_THINKING,
									thinkingSignature: "reasoning_content",
								},
							]
						: []),
					{ type: "toolCall", id, name: "synthetic_visual", arguments: {} },
				],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: ZERO_USAGE,
				stopReason: "toolUse",
				timestamp: 0,
			});
			toolMessages.push({
				role: "toolResult",
				toolCallId: id,
				toolName: "synthetic_visual",
				content: typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content,
				isError: false,
				timestamp: 0,
			});
		}
		return { systemPrompt: SYSTEM, messages: toolMessages };
	}
	return { systemPrompt: SYSTEM, messages };
}

/** Failures have only locally defined codes; never retain underlying exceptions. */
class ProbeError extends Error {
	/** @param {string} code */
	constructor(code) {
		super(code);
		this.code = code;
	}
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProbeError("payload-shape");
	return /** @type {Record<string, unknown>} */ (value);
}

/** Offline SSE response exercises the real public provider request builder, not a substitute builder.
 * @type {FetchFunction}
 */
export function offlineFetch(_input, init) {
	// Offline-only fixture: recognize expanded ordinary text in the real wire body.
	// No network, and no request data is retained or emitted by this mock.
	const body = object(JSON.parse(String(init?.body ?? "{}")));
	const long =
		Array.isArray(body.messages) &&
		body.messages.some((message) => {
			const content = object(message).content;
			return (
				Array.isArray(content) &&
				content.some((part) => {
					const item = object(part);
					return item.type === "text" && item.text === LONG_TEXT;
				})
			);
		});
	const promptTokens = long ? 29_600 : 7000;
	const cachedTokens = long ? 25_000 : 6000;
	return Promise.resolve(
		new Response(
			`data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", created: 0, model: "deepseek-flash", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: promptTokens, completion_tokens: 1, total_tokens: promptTokens + 1, prompt_tokens_details: { cached_tokens: cachedTokens } } })}\n\ndata: [DONE]\n\n`,
			{ headers: { "content-type": "text/event-stream" } },
		),
	);
}

/** No injected transport is accepted in live mode. Environment auth goes through Models.
 * @param {{ live?: boolean, stage?: Stage, env?: NodeJS.ProcessEnv, mockFetch?: FetchFunction }} [settings]
 */
export async function runProbe(settings = {}) {
	const live = settings.live === true;
	const stage = settings.stage ?? "tiny";
	if (!STAGES.includes(stage)) throw new ProbeError("invalid-stage");
	const long = stage === "long-before" || stage === "long-after";
	let scaleChecked = false;
	const images = stage === "tiny" ? [IMAGE_A, IMAGE_B] : [syntheticPng1024(0), syntheticPng1024(1)];
	const session = `synthetic-vision-cache-${randomBytes(16).toString("hex")}`;
	if (live && settings.mockFetch) throw new ProbeError("live-transport-override");
	// Explicit synthetic configuration is useful for direct-vs-Go mock comparisons.
	// Offline mode always injects a transport, including when a real host is named.
	const env = live
		? (settings.env ?? process.env)
		: (settings.env ?? {
				OPENAI_BASE_URL: "https://offline.invalid/v1",
				OPENAI_API_KEY: "synthetic-offline-not-a-credential",
			});
	const baseUrl = env.OPENAI_BASE_URL?.trim();
	if (!baseUrl) throw new ProbeError("missing-endpoint");
	let url;
	try {
		url = new URL(baseUrl);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
			throw new ProbeError("invalid-endpoint");
	} catch {
		throw new ProbeError("invalid-endpoint");
	}
	const providerId = url.hostname.toLowerCase() === "api.deepseek.com" ? "deepseek" : "opencode-go";
	const baselineId = providerId === "deepseek" ? "deepseek-flash" : "deepseek-v4.1-flash";
	const publicModels = builtinModels();
	const provider = publicModels.getProvider(providerId);
	const baseline = publicModels.getModel(providerId, baselineId);
	if (!provider || !baseline || baseline.api !== "openai-completions" || !baseline.input.includes("image"))
		throw new ProbeError("baseline-unavailable");
	const model = { ...baseline, id: "deepseek-flash", baseUrl };
	publicModels.setProvider({
		...provider,
		auth: {
			apiKey: {
				name: "OpenAI API key",
				resolve: ({ signal }) => {
					signal.throwIfAborted();
					return Promise.resolve(
						env.OPENAI_API_KEY ? { auth: { apiKey: env.OPENAI_API_KEY }, source: "OPENAI_API_KEY" } : undefined,
					);
				},
			},
		},
		getModels: () => [...provider.getModels().filter((entry) => entry.id !== model.id), model],
	});
	const globalSignal = AbortSignal.timeout(12 * 60_000);
	if (!(await publicModels.getAuth(model))) throw new ProbeError("missing-auth");
	const key = randomBytes(32); // Only in memory, new each process/run. Never written.
	/** @param {unknown} value */
	const hmac = (value) => createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
	let baselinePrefix = "";
	let baselineMessageCount = 0;
	let baselineConfig = "";
	let previousMessages = "";
	/** @type {RequestRecord[]} */
	const requests = [];
	for (let index = 0; index < LABELS.length; index++) {
		if (globalSignal.aborted) break;
		const context = contextFor(model, index, stage, images);
		const record = {
			label: LABELS[index] ?? "unknown",
			durationMs: 0,
			stopReason: "error",
			usage: /** @type {SafeUsage | null} */ (null),
			errorCode: /** @type {string | null} */ (null),
			imageCount: 0,
			messageCount: 0,
			payloadHmac: "",
			oldPrefixEqual: false,
			repeatEqual: /** @type {boolean | null} */ (null),
			configStable: false,
			...(long ? { baseUserPartOrder: /** @type {string[]} */ ([]), fullInput: 0 } : {}),
		};
		let observed = 0;
		let payloadInvalid = false;
		const started = performance.now();
		const signal = AbortSignal.any([globalSignal, AbortSignal.timeout(120_000)]);
		try {
			const answer = await publicModels.completeSimple(model, context, {
				maxTokens: 256,
				reasoning: "max",
				temperature: 0,
				sessionId: session,
				cacheRetention: "short",
				maxRetries: 0,
				timeoutMs: 120_000,
				signal,
				...(live ? {} : { fetch: settings.mockFetch ?? offlineFetch }),
				onPayload: (payload) => {
					if (++observed !== 1) throw new ProbeError("request-limit");
					const body = object(payload);
					if (!Array.isArray(body.messages)) throw new ProbeError("payload-shape");
					const messages = body.messages;
					if (long) {
						const user = messages.map(object).find((message) => message.role === "user");
						if (!Array.isArray(user?.content)) throw new ProbeError("payload-shape");
						record.baseUserPartOrder = user.content.map((part) => {
							const type = object(part).type;
							if (type !== "text" && type !== "image_url") throw new ProbeError("payload-shape");
							return type;
						});
					}
					record.imageCount = messages.reduce((count, message) => {
						const content = object(message).content;
						return (
							count +
							(Array.isArray(content) ? content.filter((part) => object(part).type === "image_url").length : 0)
						);
					}, 0);
					record.messageCount = messages.length;
					record.payloadHmac = hmac(body);
					if (index === 0) baselineMessageCount = messages.length;
					const prefix = hmac(messages.slice(0, baselineMessageCount));
					const messageHash = hmac(messages);
					// Strict allowlist: no arbitrary provider fields/headers are emitted or retained.
					const configHash = hmac([
						body.model,
						body.max_tokens,
						body.max_completion_tokens,
						body.temperature,
						body.stream,
						body.stream_options,
						body.reasoning_effort,
						body.thinking,
						body.prompt_cache_key,
						body.tools,
						body.tool_choice,
					]);
					if (index === 0) {
						baselinePrefix = prefix;
						baselineConfig = configHash;
					}
					record.oldPrefixEqual = prefix === baselinePrefix;
					record.repeatEqual = index % 2 === 1 ? messageHash === previousMessages : null;
					record.configStable = configHash === baselineConfig;
					previousMessages = messageHash;
					if (!record.configStable || record.repeatEqual === false || record.imageCount !== (index >= 4 ? 2 : 1)) {
						payloadInvalid = true;
						throw new ProbeError("payload-invariant");
					}
					return undefined; // Observer only. Never rewrite the provider payload.
				},
			});
			// Do not touch content/errorMessage/diagnostics/rawStopReason: all may contain private data.
			if (answer.stopReason !== "stop" && answer.stopReason !== "length") throw new ProbeError("provider-failed");
			record.stopReason = answer.stopReason;
			const usage = answer.usage;
			const safe = {
				input: usage.input,
				output: usage.output,
				cacheRead: usage.cacheRead,
				cacheWrite: usage.cacheWrite,
				totalTokens: usage.totalTokens,
			};
			if (
				!Object.values(safe).every((n) => Number.isFinite(n) && n >= 0) ||
				safe.input + safe.cacheRead + safe.cacheWrite <= 0 ||
				safe.totalTokens <= 0
			)
				throw new ProbeError("usage-unavailable");
			if (observed !== 1) throw new ProbeError("payload-unobserved");
			record.usage = safe;
			if (long) {
				record.fullInput = safe.input + safe.cacheRead + safe.cacheWrite;
				if (!scaleChecked) {
					scaleChecked = true;
					// This invalidates the experiment, not the successful provider response.
					if (record.fullInput < MIN_LONG_FULL_INPUT) throw new ProbeError("usage_scale_not_reached");
				}
			}
		} catch (error) {
			record.errorCode = signal.aborted
				? "timeout"
				: payloadInvalid
					? "payload-invariant"
					: error instanceof ProbeError
						? error.code
						: "provider-failed";
		}
		record.durationMs = Math.round(performance.now() - started);
		requests.push(record);
		if (record.errorCode) break; // No retries and no continuation after any failed/unusable result.
	}
	return {
		mode: live ? "live" : "offline",
		stage,
		experimentId: hmac(session),
		...(long
			? {
					longHistory: {
						textChars: LONG_TEXT.length,
						expansionFactor: 4,
						estimatedTextTokens: 29_600,
						estimatedTokensProvenance:
							"4 x approximately 7400 observed short-history fullInput; not tokenizer-measured and includes baseline overhead",
						minFullInput: MIN_LONG_FULL_INPUT,
						fullInputDefinition: "input + cacheRead + cacheWrite",
						scaleStatus: requests.some((r) => r.errorCode === "usage_scale_not_reached")
							? "invalid_experiment"
							: scaleChecked
								? "threshold_reached"
								: "unverified",
						crossSessionCachePossible: true,
						coldCacheGuaranteed: false,
					},
				}
			: {}),
		success: requests.length === 8 && requests.every((r) => r.errorCode === null),
		config: {
			provider: providerId,
			baseline: baselineId,
			wireModel: "deepseek-flash",
			api: model.api,
			reasoning: "max",
			originalModelMaxTokens: baseline.maxTokens,
			maxOutputTokens: 256,
			temperature: 0,
			cacheRetention: "short",
			sessionStable: true,
			maxRetries: 0,
			requestTimeoutMs: 120_000,
			globalTimeoutMs: 720_000,
			maxRequests: 8,
		},
		budget: {
			maxOutputTokensAllRequests: 2048,
			estimatedTextInputTokensAllRequests:
				Math.ceil(
					((long ? LONG_TEXT.length : TEXT.length) +
						SYSTEM.length +
						100 +
						(stage === "reasoning" ? LONG_THINKING.length : 0)) /
						4,
				) * 8,
			...(long ? { textInputEstimateProvenance: "characters / 4 heuristic, not tokenizer-measured" } : {}),
			inputEstimateExcludesImagesAndProviderOverhead: true,
			dollarCapGuaranteed: false,
		},
		requests,
	};
}

/** @param {string[]} args */
async function main(args) {
	const live = args.includes("--live");
	const rootArg = args.find((arg) => arg.startsWith("--artifacts-root="));
	const stageArgs = args.filter((arg) => arg.startsWith("--stage="));
	const stageArg = stageArgs[0];
	const stage = stageArg?.slice("--stage=".length) ?? "tiny";
	if (stageArgs.length > 1 || !STAGES.includes(stage)) throw new ProbeError("invalid-stage");
	if (args.some((arg) => arg !== "--live" && arg !== rootArg && arg !== stageArg) || (live && !rootArg))
		throw new ProbeError("invalid-arguments");
	const root = rootArg?.slice("--artifacts-root=".length);
	if (rootArg && !root) throw new ProbeError("invalid-artifacts-root");
	const report = await runProbe({ live, stage: /** @type {Stage} */ (stage) });
	if (root) {
		await mkdir(resolve(root), { recursive: true });
		await writeFile(
			resolve(root, `vision-cache-${Date.now()}-${randomBytes(4).toString("hex")}.json`),
			`${JSON.stringify(report, null, 2)}\n`,
			{ flag: "wx", mode: 0o600 },
		);
	}
	console.log(JSON.stringify(report, null, 2));
	if (!report.success) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error) => {
		console.log(JSON.stringify({ errorCode: error instanceof ProbeError ? error.code : "probe-failed" }));
		process.exitCode = 1;
	});
}
