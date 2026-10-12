/** Observation only at the public serialization boundary. UTF-8 JSON bytes are not
 * tokenizer tokens; identical client prefixes do not prove provider cache causality.
 * Never retains payloads, headers, credentials, prompt text or tool arguments.
 */
import { createHmac, randomBytes } from "node:crypto";
import type { AgentHarness } from "@earendil-works/pi-agent-core";
import type { ModelRequestCorrelation } from "./model-request-metrics.js";
import type { PiToolEvidence } from "./pi-tools.js";

type ObjectValue = Record<string, unknown>;
type Role = "system" | "developer" | "user" | "assistant" | "tool" | "unknown";
interface MessageDigest {
	hash: string;
	bytes: number;
	role: Role;
}
interface Snapshot {
	messages: MessageDigest[];
	format: "chat_completions" | "responses";
	systemHash: string;
	toolsHash: string;
	optionsHash: string;
}
export interface RequestPrefixMetrics {
	/** Call only after a successful explicit root navigation, never for a retry. */
	resetContext(): void;
}
const MAX_MESSAGES = 8192;
const ROLES = new Set(["system", "developer", "user", "assistant", "tool"]);
const CHAT_KEYS = new Set([
	"role",
	"content",
	"name",
	"tool_calls",
	"tool_call_id",
	"reasoning_content",
	"refusal",
	"function_call",
]);
const RESPONSE_TYPES = new Set(["message", "function_call", "function_call_output", "reasoning"]);
const RESPONSE_KEYS = new Set([
	"type",
	"role",
	"content",
	"id",
	"status",
	"call_id",
	"name",
	"arguments",
	"output",
	"summary",
	"encrypted_content",
]);
// Explicit nonsecret option allowlist. Metadata, user, cache keys, headers,
// extra_body and provider extensions are deliberately never read or hashed.
const NUMERIC_OPTIONS = [
	"temperature",
	"top_p",
	"max_tokens",
	"max_completion_tokens",
	"max_output_tokens",
	"seed",
	"frequency_penalty",
	"presence_penalty",
	"n",
	"top_logprobs",
];
const BOOLEAN_OPTIONS = ["stream", "store", "parallel_tool_calls", "logprobs"];
function object(value: unknown): ObjectValue | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as ObjectValue) : null;
}
function supportedTools(value: unknown): boolean {
	if (value === undefined) return true;
	if (!Array.isArray(value)) return false;
	return value.every((item) => {
		const tool = object(item);
		if (!tool || tool.type !== "function") return false;
		const schema = object(tool.function) ?? tool;
		const keys = new Set(["name", "description", "parameters", "strict", ...(schema === tool ? ["type"] : [])]);
		return (
			typeof schema.name === "string" &&
			Object.keys(schema).every((key) => keys.has(key)) &&
			(schema === tool || Object.keys(tool).every((key) => key === "type" || key === "function"))
		);
	});
}
function role(value: unknown): Role {
	return typeof value === "string" && ROLES.has(value) ? (value as Role) : "unknown";
}
function options(payload: ObjectValue): ObjectValue {
	const selected: ObjectValue = {};
	if (typeof payload.model === "string") selected.model = payload.model;
	for (const key of NUMERIC_OPTIONS) {
		const value = payload[key];
		if (typeof value === "number" && Number.isFinite(value)) selected[key] = value;
	}
	for (const key of BOOLEAN_OPTIONS) if (typeof payload[key] === "boolean") selected[key] = payload[key];
	const effort = payload.reasoning_effort ?? object(payload.reasoning)?.effort;
	if (["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(effort)))
		selected.reasoningEffort = effort;
	const summary = object(payload.reasoning)?.summary;
	if (["auto", "concise", "detailed"].includes(String(summary))) selected.reasoningSummary = summary;
	const thinking = object(payload.thinking)?.type;
	if (thinking === "enabled" || thinking === "disabled") selected.thinking = thinking;
	const stream = object(payload.stream_options)?.include_usage;
	if (typeof stream === "boolean") selected.includeUsage = stream;
	if (["auto", "none", "required"].includes(String(payload.tool_choice))) selected.toolChoice = payload.tool_choice;
	const choice = object(payload.tool_choice);
	const choiceName = object(choice?.function)?.name ?? choice?.name;
	if (choice?.type === "function" && typeof choiceName === "string")
		selected.toolChoice = { type: "function", name: choiceName };
	return selected;
}

/** Install last: any earlier transform/payload hook has already run. No rewrite,
 * no provider-private API; exceptions are contained without persisting error text.
 * State is at most MAX_MESSAGES small hash/byte/role records, independent of image size.
 */
export function installRequestPrefixMetrics(
	harness: Pick<AgentHarness<undefined>, "hooks">,
	evidence: PiToolEvidence,
	now: () => string,
	correlation: ModelRequestCorrelation,
): RequestPrefixMetrics {
	// Per-attach secret key prevents dictionary recovery of low-entropy content.
	// Neither key nor individual message digests are ever exported.
	const key = randomBytes(32);
	const digest = (value: unknown): string =>
		createHmac("sha256", key)
			.update(JSON.stringify(value) ?? "null")
			.digest("hex");
	let previous: Snapshot | null = null;
	let segment = 1;
	let observation = 0;
	let pending: { requestId: string | null; observation: number; segment: number } | null = null;
	harness.hooks.on("before_payload", async ({ payload }) => {
		const identity = { requestId: correlation.currentRequestId(), observation: ++observation, segment };
		pending = identity;
		try {
			const body = object(payload);
			const format = Array.isArray(body?.messages)
				? "chat_completions"
				: Array.isArray(body?.input)
					? "responses"
					: null;
			const source = format === "chat_completions" ? body?.messages : body?.input;
			if (
				!body ||
				!format ||
				!supportedTools(body.tools) ||
				!Array.isArray(source) ||
				source.length > MAX_MESSAGES ||
				!source.every((item) => {
					const entry = object(item);
					if (!entry) return false;
					return format === "chat_completions"
						? role(entry.role) !== "unknown" && Object.keys(entry).every((key) => CHAT_KEYS.has(key))
						: Object.keys(entry).every((key) => RESPONSE_KEYS.has(key)) &&
								(entry.type === undefined
									? role(entry.role) !== "unknown"
									: RESPONSE_TYPES.has(String(entry.type)));
				})
			) {
				previous = null;
				await evidence.appendRuntime("model.requested", now(), {
					phase: "request_prefix",
					...identity,
					unsupported: true,
				});
				return undefined;
			}
			const images: string[] = [];
			const reasoning: string[] = [];
			const system: string[] = [];
			const messages = source.map((item): MessageDigest => {
				const entry = item as ObjectValue;
				const serialized = JSON.stringify(entry);
				const hash = digest(entry);
				const entryRole =
					entry.type === "function_call" || entry.type === "reasoning"
						? "assistant"
						: entry.type === "function_call_output"
							? "tool"
							: role(entry.role);
				if (entryRole === "system" || entryRole === "developer") system.push(hash);
				if (typeof entry.reasoning_content === "string") reasoning.push(digest(entry.reasoning_content));
				if (entry.type === "reasoning") reasoning.push(hash);
				if (Array.isArray(entry.content))
					for (const part of entry.content) {
						const content = object(part);
						if (content?.type === "image_url") images.push(digest(content.image_url));
						if (content?.type === "input_image") images.push(digest(content));
					}
				return { hash, bytes: Buffer.byteLength(serialized, "utf8"), role: entryRole };
			});
			if (format === "responses" && typeof body.instructions === "string") system.push(digest(body.instructions));
			const current: Snapshot = {
				messages,
				format,
				systemHash: digest(system),
				toolsHash: digest(body.tools ?? []),
				optionsHash: digest(options(body)),
			};
			const old = previous?.format === format ? previous : null;
			let prefix = 0;
			let prefixBytes = 0;
			while (
				old &&
				prefix < Math.min(old.messages.length, messages.length) &&
				old.messages[prefix]?.hash === messages[prefix]?.hash
			) {
				prefixBytes += messages[prefix]?.bytes ?? 0;
				prefix++;
			}
			const changed = old && prefix < old.messages.length ? prefix : null;
			previous = current;
			await evidence.appendRuntime("model.requested", now(), {
				phase: "request_prefix",
				...identity,
				unsupported: false,
				format,
				previousMessageCount: old?.messages.length ?? 0,
				currentMessageCount: messages.length,
				messageBytes: messages.reduce((sum, message) => sum + message.bytes, 0),
				prefixMessageCount: prefix,
				prefixBytes,
				appendOnly: old === null ? null : changed === null,
				firstChangedIndex: changed,
				firstChangedRole:
					changed === null ? null : (messages[changed]?.role ?? old?.messages[changed]?.role ?? "unknown"),
				messageChainHash: digest(messages.map((message) => message.hash)),
				systemHash: current.systemHash,
				toolsHash: current.toolsHash,
				optionsHash: current.optionsHash,
				systemStable: old === null ? null : old.systemHash === current.systemHash,
				toolsStable: old === null ? null : old.toolsHash === current.toolsHash,
				optionsStable: old === null ? null : old.optionsHash === current.optionsHash,
				actualImageCount: images.length,
				imageHash: digest(images),
				reasoningHash: digest(reasoning),
			});
		} catch {
			previous = null;
			try {
				await evidence.appendRuntime("model.requested", now(), {
					phase: "request_prefix",
					...identity,
					diagnosticFailed: true,
				});
			} catch {
				/* Diagnostics cannot block authority or leak exception text. */
			}
		}
		return undefined;
	});
	harness.hooks.on("after_response", async () => {
		const identity = pending;
		pending = null;
		if (identity)
			try {
				await evidence.appendRuntime("model.responded", now(), { phase: "request_prefix", ...identity });
			} catch {
				/* Observation only. */
			}
		return undefined;
	});
	return {
		resetContext: () => {
			previous = null;
			pending = null;
			segment++;
		},
	};
}
