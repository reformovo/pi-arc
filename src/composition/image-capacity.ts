/** 段内图片只追加；容量不足时由 runtime 请求 ARC checkpoint，不改写旧消息。 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { MAX_INSPECT_VIEWS } from "../application/model-tools.js";
import type { JsonValue } from "../protocol/canonical-json.js";

export function countContextImages(messages: readonly AgentMessage[]): number {
	return messages.reduce(
		(count, message) =>
			count +
			((message.role === "user" || message.role === "toolResult") && Array.isArray(message.content)
				? message.content.filter((part) => part.type === "image").length
				: 0),
		0,
	);
}

/** before_tool 已通过公开 schema 校验；业务失败只会减少结果图片，不会增加。
 * 精确投影避免为每次 play 永久保留 16 个槽；恢复 prompt 在独立 admission 处计数。
 */
export function projectedToolImages(toolName: string, args: Record<string, JsonValue>): number {
	if (toolName === "play") return 1;
	if (toolName !== "inspect") return 0;
	return Array.isArray(args.views) && args.views.length >= 1 && args.views.length <= MAX_INSPECT_VIEWS
		? args.views.length
		: MAX_INSPECT_VIEWS;
}
