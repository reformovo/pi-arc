/**
 * 将 provider-neutral 工具映射到稳定 AgentHarness v4 的公开工具接口。
 *
 * 同一 assistant response 的 play admission 先写入 runtime inventory，随后
 * 才能执行 Environment effect；重启后从该 inventory 恢复顺序门禁。runtime
 * 记录只用于拒绝后续工具，绝不证明 Action 已完成。
 */

import type { AgentHarnessTool, AgentHarnessToolInvocation } from "@earendil-works/pi-agent-core";
import type { RuntimeRecord } from "../adapters/artifact-store.js";
import { canonicalJsonDigest } from "../adapters/sha256.js";
import { encodeVisualPng } from "../adapters/visual-png.js";
import { MODEL_TOOL_DEFINITIONS } from "../application/model-prompts.js";
import {
	type ModelToolExecutor,
	RESULT_SCHEMA,
	TOOL_SCHEMA,
	type ToolName,
	type ToolResult,
} from "../application/model-tools.js";
import type { JsonValue } from "../protocol/canonical-json.js";

export interface PiToolEvidence {
	readRuntime(): Promise<readonly RuntimeRecord[]>;
	appendRuntime(
		eventType: RuntimeRecord["eventType"],
		recordedAt: string,
		payload: Record<string, JsonValue>,
	): Promise<RuntimeRecord>;
}

export interface PiToolAdapterOptions {
	executor: ModelToolExecutor;
	evidence: PiToolEvidence;
	now(): string;
	isTerminated(): boolean;
}

function rejection(name: ToolName, invocationId: string, code: "observation_required" | "terminal"): ToolResult {
	return {
		schema: RESULT_SCHEMA,
		invocationId,
		name,
		ok: false,
		error: {
			code,
			message: code === "terminal" ? "Run is terminated" : "Observe the play result before another tool call",
		},
	};
}

/** 运行时只记录 identity、状态与 code，不记录参数、模型正文或凭据。 */
export class PiToolAdapter {
	private readonly playTurns = new Set<string>();
	private readonly options: PiToolAdapterOptions;

	private constructor(options: PiToolAdapterOptions) {
		this.options = options;
	}

	static async create(options: PiToolAdapterOptions): Promise<PiToolAdapter> {
		const adapter = new PiToolAdapter(options);
		for (const record of await options.evidence.readRuntime()) {
			if (
				record.eventType === "tool.admitted" &&
				record.payload.name === "play" &&
				typeof record.payload.turnId === "string"
			) {
				adapter.playTurns.add(record.payload.turnId);
			}
		}
		return adapter;
	}

	tools(): AgentHarnessTool<undefined>[] {
		return MODEL_TOOL_DEFINITIONS.map((definition) => ({
			name: definition.name,
			label: definition.name,
			description: definition.description,
			// pi-ai 0.86 的公开 validator 接受普通 JSON Schema；业务层仍做严格校验。
			parameters: definition.inputSchema as unknown as AgentHarnessTool<undefined>["parameters"],
			replay: definition.name === "play" ? "never" : "safe",
			execute: async (_toolCallId, params, _onUpdate, _toolContext, invocation) =>
				this.execute(definition.name, params as Record<string, JsonValue>, invocation),
		}));
	}

	private async execute(name: ToolName, args: Record<string, JsonValue>, invocation: AgentHarnessToolInvocation) {
		const { invocationId, turnId } = invocation;
		if (this.options.isTerminated()) {
			const envelope = rejection(name, invocationId, "terminal");
			await this.recordRejection(envelope, turnId);
			return {
				content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
				details: envelope,
				terminate: true,
			};
		}
		if (this.playTurns.has(turnId)) return this.reject(rejection(name, invocationId, "observation_required"), turnId);

		// Pi memo 只钉住 safe invocation 的参数，不作为外部副作用完成证明。
		const argsDigest = canonicalJsonDigest(args);
		const memo = await invocation.getMemo("pi-arc.argsDigest");
		if (memo !== undefined && memo !== argsDigest) throw new Error("safe invocation arguments changed during replay");
		if (memo === undefined) await invocation.setMemo("pi-arc.argsDigest", argsDigest);

		if (name === "play") {
			await this.options.evidence.appendRuntime("tool.admitted", this.options.now(), {
				name,
				invocationId,
				turnId,
			});
			this.playTurns.add(turnId);
		}
		const executed = await this.options.executor.execute({ schema: TOOL_SCHEMA, invocationId, name, args });
		const envelope = executed.envelope;
		await this.options.evidence.appendRuntime(envelope.ok ? "tool.completed" : "tool.rejected", this.options.now(), {
			name,
			invocationId,
			turnId,
			ok: envelope.ok,
			...(envelope.error === undefined ? {} : { code: envelope.error.code }),
		});
		const safeEnvelope =
			envelope.error?.code === "storage_failure"
				? { ...envelope, error: { code: "storage_failure" as const, message: "Tool storage failed" } }
				: envelope;
		if (!safeEnvelope.ok && !this.options.isTerminated()) throw new Error(JSON.stringify(safeEnvelope));
		return {
			content: [
				{ type: "text" as const, text: JSON.stringify(safeEnvelope) },
				...executed.images.map((visual) => ({
					type: "image" as const,
					data: Buffer.from(encodeVisualPng(visual)).toString("base64"),
					mimeType: "image/png",
				})),
			],
			details: safeEnvelope,
			...(this.options.isTerminated() ? { terminate: true } : {}),
		};
	}

	private async reject(envelope: ToolResult, turnId: string): Promise<never> {
		await this.recordRejection(envelope, turnId);
		throw new Error(JSON.stringify(envelope));
	}

	private async recordRejection(envelope: ToolResult, turnId: string): Promise<void> {
		await this.options.evidence.appendRuntime("tool.rejected", this.options.now(), {
			name: envelope.name,
			invocationId: envelope.invocationId,
			turnId,
			ok: false,
			code: envelope.error?.code ?? "invalid_request",
		});
	}
}
