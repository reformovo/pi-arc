/**
 * CLI-compatible 事件的持久投影。
 *
 * domain/runtime ledger 仍分别是 Environment 与模型诊断的来源；events.jsonl
 * 只是可重建的观察流。重启时按 source identity 补齐漏写事件，绝不凭事件
 * 反推或重放 Environment Action。
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactStore, DomainRecord, RuntimeRecord } from "../adapters/artifact-store.js";
import { canonicalJson, type JsonValue } from "../protocol/canonical-json.js";

export type RunEventType =
	| "run.started"
	| "run.resumed"
	| "model.requested"
	| "model.responded"
	| "tool.completed"
	| "tool.rejected"
	| "action.intent"
	| "environment.receipt"
	| "turn.committed"
	| "context.boundary"
	| "audit.finding"
	| "audit.completed"
	| "run.completed"
	| "run.rejected";

export interface RunEvent extends Record<string, JsonValue> {
	schema: "pi-arc.cli-event.v1";
	sequence: number;
	occurredAt: string;
	runId: string | null;
	type: RunEventType;
	data: Record<string, JsonValue>;
}

function isMissing(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

const domainTypes: Partial<Record<DomainRecord["recordType"], RunEventType>> = {
	"action.intent": "action.intent",
	"environment.receipt": "environment.receipt",
	"turn.commit": "turn.committed",
	"context.boundary": "context.boundary",
};

const runtimeTypes: Partial<Record<RuntimeRecord["eventType"], RunEventType>> = {
	"model.requested": "model.requested",
	"model.responded": "model.responded",
	"tool.completed": "tool.completed",
	"tool.rejected": "tool.rejected",
	"context.boundary": "context.boundary",
};

/** 每个 Run 只有一个 writer；重复 source sequence 被忽略。 */
export class RunEventJournal {
	constructor(
		private readonly root: string,
		private readonly runId: string,
		private readonly now: () => string,
	) {}

	async read(afterSequence = 0): Promise<RunEvent[]> {
		if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new TypeError("afterSequence is invalid");
		let content: string;
		try {
			content = await readFile(path.join(this.root, "events.jsonl"), "utf8");
		} catch (error) {
			if (isMissing(error)) return [];
			throw error;
		}
		if (content.length > 0 && !content.endsWith("\n")) throw new Error("events.jsonl has a torn final line");
		const events = content
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as RunEvent);
		for (const [index, event] of events.entries()) {
			if (event.schema !== "pi-arc.cli-event.v1" || event.sequence !== index + 1 || event.runId !== this.runId)
				throw new Error("events.jsonl identity or sequence is invalid");
		}
		return events.filter((event) => event.sequence > afterSequence);
	}

	async append(type: RunEventType, data: Record<string, JsonValue>, source?: string): Promise<RunEvent> {
		const events = await this.read();
		const existing = source === undefined ? undefined : events.find((item) => item.data.source === source);
		if (existing !== undefined) return existing;
		const event: RunEvent = {
			schema: "pi-arc.cli-event.v1",
			sequence: events.length + 1,
			occurredAt: this.now(),
			runId: this.runId,
			type,
			data: source === undefined ? data : { ...data, source },
		};
		await mkdir(this.root, { recursive: true });
		const target = path.join(this.root, "events.jsonl");
		const temporary = `${target}.partial`;
		await writeFile(temporary, `${[...events, event].map((item) => canonicalJson(item)).join("\n")}\n`, "utf8");
		await rename(temporary, target);
		return event;
	}

	async domain(record: DomainRecord): Promise<void> {
		const type = domainTypes[record.recordType];
		if (type === undefined) return;
		await this.append(type, { ledgerSequence: record.sequence }, `domain:${record.sequence}`);
	}

	async runtime(record: RuntimeRecord): Promise<void> {
		const type = runtimeTypes[record.eventType];
		if (type === undefined) return;
		await this.append(type, { runtimeSequence: record.sequence, ...record.payload }, `runtime:${record.sequence}`);
	}

	/** 修复 ledger 已提交、事件尚未发布时的 crash window。 */
	async reconcile(artifacts: ArtifactStore): Promise<void> {
		for (const record of await artifacts.readDomain()) await this.domain(record);
		for (const record of await artifacts.readRuntime()) await this.runtime(record);
	}
}
