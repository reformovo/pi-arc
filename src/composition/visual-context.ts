/** 活动模型上下文的图片预算；完整 Pi session/Raw Frame archive 保持不变。 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** OpenCode Go DeepSeek 实际拒绝 >64 图片的请求（真实 cd82 smoke 证据）。 */
export const DEEPSEEK_CONTEXT_IMAGE_LIMIT = 64;

export function boundVisualContext(messages: AgentMessage[], limit: number): AgentMessage[] {
	let remaining = limit;
	// 从新到旧保留图片，消息顺序、工具 identity 和全部文字内容不变。
	return [...messages]
		.reverse()
		.map((message): AgentMessage => {
			if ((message.role !== "user" && message.role !== "toolResult") || !Array.isArray(message.content))
				return message;
			return {
				...message,
				content: [...message.content]
					.reverse()
					.map((part) => {
						if (part.type !== "image") return part;
						if (remaining > 0) {
							remaining -= 1;
							return part;
						}
						return {
							type: "text" as const,
							text: "[Older image omitted from active context. Use inspect with its archived Turn/Frame to retrieve it.]",
						};
					})
					.reverse(),
			};
		})
		.reverse();
}
