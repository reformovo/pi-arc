/** CLI 纯协议测试：不创建模型、sidecar、Game 或网络连接。 */

import { createModels } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/composition/cli.js";
import { createPiArcHost } from "../../src/composition/index.js";
import type { AuditResult, PiArcHost, RunResult } from "../../src/composition/pi-arc-host.js";

const now = () => "2026-09-24T00:00:00Z";
const digest = "a".repeat(64);
const flags = [
	"run",
	"--game-id",
	"ls20-9607627b",
	"--game-cache",
	"/tmp/cache",
	"--provider",
	"faux",
	"--model",
	"faux-model",
	"--artifacts",
	"/tmp/artifacts",
];

function report(ok: boolean): AuditResult {
	return {
		schema: "pi-arc.audit.v1",
		runId: "test-run",
		ok,
		manifestDigest: digest,
		ledgerHead: digest,
		findings: ok ? [] : [{ code: "tampered", severity: "error", message: "archive was changed" }],
	};
}

function result(outcomeClass: RunResult["outcomeClass"]): RunResult {
	return {
		runId: "test-run",
		game: { id: "ls20-9607627b", sourceLocator: "arc-agi://public/ls20-9607627b?sdk=0.9.9", treeDigest: digest },
		outcomeClass,
		terminationReason: outcomeClass === "win" ? "WIN" : "model_failure",
		lastCommittedTurn: 0,
		artifactRoot: "/tmp/artifacts",
		manifest: "/tmp/artifacts/manifest.json",
		audit: report(outcomeClass !== "audit_failure"),
	};
}

function fakeHost(outcomeClass: RunResult["outcomeClass"]): PiArcHost {
	return {
		run: async () => ({ status: "terminated", result: result(outcomeClass) }),
		resume: async () => ({ status: "terminated", result: result(outcomeClass) }),
		audit: async () => report(outcomeClass !== "audit_failure"),
		readEvents: async function* () {},
	};
}

async function invoke(argv: string[], host: PiArcHost) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const code = await runCli(
		argv,
		host,
		{ stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
		now,
	);
	return {
		code,
		events: stdout
			.join("")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { type: string; sequence: number; data: Record<string, unknown> }),
		stderr,
	};
}

describe("CLI exact surface", () => {
	it("exports only the public SDK host capability from its root entry", () => {
		const host = createPiArcHost(createModels());
		expect(Object.keys(host).sort()).toEqual(["audit", "readEvents", "resume", "run"]);
	});

	it("rejects unknown command, duplicate/unknown flags, invalid budget and thinking with code 2", async () => {
		const host = fakeHost("win");
		for (const argv of [
			["play"],
			[...flags, "--provider", "again"],
			[...flags, "--unknown", "x"],
			[...flags, "--action-budget", "0"],
			[...flags, "--action-budget", "1000000"],
			[...flags, "--action-budget", "999999999999999999999"],
			flags.map((value) => (value === "ls20-9607627b" ? "ls20" : value)),
			[...flags, "--thinking", "impossible"],
			["resume", "--artifacts", "/tmp/x", "--model", "m"],
		]) {
			const output = await invoke(argv, host);
			expect(output.code).toBe(2);
			expect(output.events).toHaveLength(1);
			expect(output.events[0]?.type).toBe("run.rejected");
		}
	});

	it("keeps startup rejection distinct from known/unknown/audit terminal outcomes", async () => {
		const rejected: PiArcHost = {
			...fakeHost("win"),
			run: async () => ({ status: "rejected", reason: "game_cache_miss" }),
		};
		expect((await invoke(flags, rejected)).code).toBe(3);
		expect(
			(await invoke([...flags, "--game-offline", "--thinking", "off", "--action-budget", "1"], rejected)).code,
		).toBe(3);
		for (const [outcome, code] of [
			["win", 0],
			["non_success", 10],
			["unknown_outcome", 20],
			["audit_failure", 30],
		] as const) {
			const output = await invoke(flags, fakeHost(outcome));
			expect(output.code).toBe(code);
			expect(output.events.at(-1)?.type).toBe("run.completed");
		}
	});

	it("accepts the full versioned ID grammar and maximum budget without guessing a version", async () => {
		const output = await invoke(
			[...flags.map((value) => (value === "ls20-9607627b" ? "abcd-XYZ123" : value)), "--action-budget", "999999"],
			fakeHost("win"),
		);
		expect(output.code).toBe(0);
	});

	it("reports corrupt archives and controller failures with a final event and code 30", async () => {
		for (const reason of ["archive_invalid", "controller_failure", "evidence_corrupt"]) {
			const host = { ...fakeHost("win"), resume: async () => ({ status: "rejected" as const, reason }) };
			expect((await invoke(["resume", "--artifacts", "/tmp/x"], host)).code).toBe(30);
		}
		const host = {
			...fakeHost("non_success"),
			run: async () => ({
				status: "terminated" as const,
				result: { ...result("non_success"), terminationReason: "controller_failure" },
			}),
		};
		expect((await invoke(flags, host)).code).toBe(30);
		const corrupt = {
			...fakeHost("win"),
			readEvents: async function* () {
				await Promise.resolve();
				yield {
					schema: "pi-arc.cli-event.v1" as const,
					sequence: 1,
					occurredAt: now(),
					runId: "test-run",
					type: "run.started" as const,
					data: {},
				};
				throw new Error("corrupt");
			},
		};
		const output = await invoke(flags, corrupt);
		expect(output.code).toBe(30);
		expect(output.events.at(-1)).toMatchObject({
			type: "run.completed",
			data: { outcomeClass: "audit_failure", terminationReason: "evidence_corrupt" },
		});
	});

	it("audit failure emits findings and exactly one final audit.completed", async () => {
		const output = await invoke(["audit", "--artifacts", "/tmp/does-not-exist"], fakeHost("audit_failure"));
		expect(output.code).toBe(30);
		expect(output.events.map((event) => event.type)).toEqual(["audit.finding", "audit.completed"]);
		expect(output.events.map((event) => event.sequence)).toEqual([1, 2]);
	});
});
