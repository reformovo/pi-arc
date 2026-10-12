/** 每次 provider request 的诊断指标；不保存正文、图片、header、auth 或错误原文。 */
import type { AgentHarness, AgentMessage } from "@earendil-works/pi-agent-core";
import type { PiToolEvidence } from "./pi-tools.js";

function imageCount(messages: AgentMessage[]): number {
	return messages.reduce((total, message) => {
		if ((message.role !== "user" && message.role !== "toolResult") || !Array.isArray(message.content)) return total;
		return total + message.content.filter((part) => part.type === "image").length;
	}, 0);
}

export interface ModelRequestCorrelation {
	currentRequestId(): string | null;
}

/** 必须在上下文投影 hook 之后安装，图片数量才是实际投影而非完整归档的数量。 */
export function installModelRequestMetrics(
	harness: Pick<AgentHarness<undefined>, "hooks">,
	evidence: PiToolEvidence,
	now: () => string,
	elapsed: () => number = () => performance.now(),
): ModelRequestCorrelation {
	let images = 0;
	let sequence = 0;
	let current: { requestId: string; started: number } | null = null;
	harness.hooks.on("transform_context", ({ messages }) => {
		images = imageCount(messages);
		return undefined;
	});
	harness.hooks.on("before_request", async ({ model, step, attempt }) => {
		// requestId 仅用于本次 attach 的诊断关联，不作为恢复/副作用 identity。
		const requestId = `${now()}-${++sequence}`;
		current = { requestId, started: elapsed() };
		await evidence.appendRuntime("model.requested", now(), {
			phase: "provider_request",
			requestId,
			provider: model.provider,
			modelId: model.id,
			step,
			attempt,
		});
		return undefined;
	});
	harness.hooks.on("after_response", async ({ message, status }) => {
		if (current === null) return undefined;
		const { requestId, started } = current;
		current = null;
		const usage = message.usage;
		await evidence.appendRuntime("model.responded", now(), {
			phase: "provider_request",
			requestId,
			// before_request 先于 transform_context，最终图片数只能在响应记录中发布。
			imageCount: images,
			durationMs: Math.max(0, Math.round(elapsed() - started)),
			stopReason: message.stopReason,
			...(status === undefined ? {} : { httpStatus: status }),
			usage: {
				input: usage.input,
				output: usage.output,
				cacheRead: usage.cacheRead,
				cacheWrite: usage.cacheWrite,
				totalTokens: usage.totalTokens,
				...(usage.reasoning === undefined ? {} : { reasoning: usage.reasoning }),
			},
		});
		return undefined;
	});
	return { currentRequestId: () => current?.requestId ?? null };
}
