/** 事件投影的重启去重、分页和损坏拒绝；不把 event 当成 Action 证据。 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/adapters/artifact-store.js";
import { RunEventJournal } from "../../src/composition/run-events.js";

const now = () => "2026-09-24T00:00:00Z";

describe("Run event journal", () => {
	it("projects domain and runtime records idempotently across a restart", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "pi-arc-event-"));
		const artifacts = new ArtifactStore(root);
		const journal = new RunEventJournal(root, "run-1", now);
		const domain = await artifacts.appendDomain("action.intent", now(), { actionId: "action-1" });
		const runtime = await artifacts.appendRuntime("model.requested", now(), { provider: "faux" });
		await journal.domain(domain);
		await journal.runtime(runtime);
		await journal.domain(await artifacts.appendDomain("run.binding", now(), { runId: "run-1" }));
		await journal.runtime(await artifacts.appendRuntime("tool.admitted", now(), { name: "play" }));
		await journal.reconcile(artifacts);
		const events = await journal.read();
		expect(events.map((event) => event.type)).toEqual(["action.intent", "model.requested"]);
		expect(events.map((event) => event.sequence)).toEqual([1, 2]);
		expect(await journal.read(1)).toEqual(events.slice(1));
		await expect(journal.read(-1)).rejects.toThrow("afterSequence");
	});

	it("rejects torn lines, sequence gaps and another Run identity", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "pi-arc-event-corrupt-"));
		const journal = new RunEventJournal(root, "run-1", now);
		await journal.append("run.started", { game: "test" });
		const file = path.join(root, "events.jsonl");
		const valid = await readFile(file, "utf8");
		await writeFile(file, valid.trimEnd(), "utf8");
		await expect(journal.read()).rejects.toThrow("torn final line");
		await writeFile(file, valid.replace('"sequence":1', '"sequence":2'), "utf8");
		await expect(journal.read()).rejects.toThrow("identity or sequence");
		await writeFile(file, valid.replace('"runId":"run-1"', '"runId":"other"'), "utf8");
		await expect(journal.read()).rejects.toThrow("identity or sequence");
	});
});
