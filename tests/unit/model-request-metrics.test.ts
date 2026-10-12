/** 公共 Pi hooks 指标测试：不使用真实 provider，不保存请求敏感内容。 */
import { AgentHarness, MemorySessionRepo, TODO_CONTEXT } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";
import type { RuntimeRecord } from "../../src/adapters/artifact-store.js";
import { installModelRequestMetrics } from "../../src/composition/model-request-metrics.js";

describe("per-request model metrics", () => {
	it("records numeric usage and projected image counts without message or auth content", async () => {
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		faux.setResponses([fauxAssistantMessage("private-response-body")]);
		const repo = new MemorySessionRepo();
		const session = await repo.create({}, TODO_CONTEXT);
		const { harness } = await AgentHarness.create({ session, models, model: faux.getModel() }, TODO_CONTEXT);
		const records: RuntimeRecord[] = [];
		let milliseconds = 10;
		harness.hooks.on("transform_context", ({ messages }) => ({
			messages: messages.map((message) =>
				message.role === "user"
					? {
							...message,
							content: [{ type: "image" as const, data: "private-image", mimeType: "image/png" }],
						}
					: message,
			),
		}));
		installModelRequestMetrics(
			harness,
			{
				readRuntime: async () => records,
				appendRuntime: (eventType, recordedAt, payload) => {
					const record: RuntimeRecord = {
						schema: "pi-arc.runtime-record.v1",
						sequence: records.length + 1,
						eventType,
						recordedAt,
						payload,
					};
					records.push(record);
					return Promise.resolve(record);
				},
			},
			() => "2026-10-08T00:00:00Z",
			() => milliseconds++,
		);
		try {
			const lane = await harness.lane("main", TODO_CONTEXT);
			await lane.prompt("private-request-body", undefined, TODO_CONTEXT);
			expect(records).toHaveLength(2);
			expect(records[0]?.payload).toMatchObject({ phase: "provider_request", step: "assistant" });
			expect(records[1]?.payload).toMatchObject({
				phase: "provider_request",
				durationMs: 1,
				stopReason: "stop",
				imageCount: 1,
			});
			expect(records[1]?.payload.requestId).toBe(records[0]?.payload.requestId);
			expect(records[1]?.payload.usage).toMatchObject({
				input: expect.any(Number),
				cacheRead: expect.any(Number),
				output: expect.any(Number),
			});
			expect(JSON.stringify(records)).not.toContain("private-");
		} finally {
			await harness.close(TODO_CONTEXT);
			await repo.close(TODO_CONTEXT);
		}
	});
});
