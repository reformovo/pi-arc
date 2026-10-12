/** 编译后的 CLI 进程回归：无凭据、Game 获取或真实模型请求。 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/adapters/artifact-store.js";

const execute = promisify(execFile);
let root: string;
let entry: string;
const timestamp = "2026-09-24T00:00:00Z";

beforeAll(async () => {
	// 在工作树临时目录编译，使用同一 Node、锁定 TypeScript 与依赖，不依赖旧 dist。
	root = await mkdtemp(path.join(process.cwd(), ".cli-process-"));
	const output = path.join(root, "compiled");
	await execute(process.execPath, [
		"node_modules/typescript/bin/tsc",
		"-p",
		"tsconfig.build.json",
		"--outDir",
		output,
	]);
	entry = path.join(output, "composition/cli.js");
}, 60_000);

afterAll(async () => {
	if (root) await rm(root, { recursive: true, force: true });
});

async function invoke(argv: string[], baseUrl = "not-a-url-private-sentinel") {
	// 显式白名单，不把宿主 provider 凭据或配置传入子进程。
	const env = { OPENAI_BASE_URL: baseUrl, PATH: path.dirname(process.execPath) };
	let stdout: string;
	let stderr: string;
	let code: number;
	try {
		({ stdout, stderr } = await execute(process.execPath, [entry, ...argv], { env }));
		code = 0;
	} catch (error) {
		const failure = error as { code: number; stdout: string; stderr: string };
		({ code, stdout, stderr } = failure);
	}
	expect(stdout).not.toContain(baseUrl);
	expect(stderr).not.toContain(baseUrl);
	expect(stderr).not.toContain("Error:");
	const events = stdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	for (const [index, event] of events.entries()) {
		expect(Object.keys(event).sort()).toEqual(["data", "occurredAt", "runId", "schema", "sequence", "type"]);
		expect(event.schema).toBe("pi-arc.cli-event.v1");
		expect(event.sequence).toBe(index + 1);
	}
	return { code, events, stderr };
}

describe("CLI process initialization", () => {
	it("audits valid archives with invalid model env and preserves each existing outcome", async () => {
		for (const [outcomeClass, terminationReason, code] of [
			["win", "WIN", 0],
			["non_success", "action_budget_exhausted", 10],
			["unknown_outcome", "unknown_action_outcome", 20],
		] as const) {
			const archive = path.join(root, outcomeClass);
			const store = new ArtifactStore(archive);
			await store.writeManifest({
				schema: "pi-arc.run-manifest.v1",
				runId: "cli-process-test",
				game: {
					id: "ls20-9607627b",
					sourceLocator: "arc-agi://public/ls20-9607627b?sdk=0.9.9",
					treeDigest: "0".repeat(64),
				},
				model: { provider: "fake", modelId: "offline-model" },
				runtime: { piAgentCore: "0.86.0", piAi: "0.86.0" },
				coordinates: 1024,
				seed: 42,
				config: { actionBudget: 1, gameOffline: true },
			});
			const binding = await store.appendDomain("run.binding", timestamp, { runId: "cli-process-test" });
			await store.writeTerminal({
				schema: "pi-arc.terminal.v1",
				runId: "cli-process-test",
				outcomeClass,
				terminationReason,
				lastCommittedTurn: 0,
				ledgerHead: binding.digest,
				recordedAt: timestamp,
			});
			expect((await store.rebuildAudit()).ok).toBe(true);
			const auditBefore = await readFile(path.join(archive, "audit.json"), "utf8");
			const output = await invoke(["audit", "--artifacts", archive]);
			expect(output.code).toBe(code);
			expect(output.events).toEqual([
				expect.objectContaining({ type: "audit.completed", data: expect.objectContaining({ ok: true }) }),
			]);
			expect(await readFile(path.join(archive, "audit.json"), "utf8")).toBe(auditBefore);
		}
	});

	it("reports invalid archives independently of invalid model env", async () => {
		const output = await invoke(["audit", "--artifacts", path.join(root, "missing")]);
		expect(output.code).toBe(30);
		expect(output.events.at(-1)).toMatchObject({ type: "audit.completed", data: { ok: false } });
	});

	it("rejects run/resume static model configuration in JSONL before creating artifacts", async () => {
		const archive = path.join(root, "not-started");
		for (const argv of [
			[
				"run",
				"--game-id",
				"ls20-9607627b",
				"--game-cache",
				path.join(root, "cache"),
				"--provider",
				"fake",
				"--model",
				"fake",
				"--artifacts",
				archive,
				"--game-offline",
			],
			["resume", "--artifacts", archive],
		]) {
			const output = await invoke(argv);
			expect(output.code).toBe(2);
			expect(output.events).toEqual([
				expect.objectContaining({
					runId: null,
					type: "run.rejected",
					data: { reason: "invalid_model_configuration" },
				}),
			]);
		}
		await expect(readFile(path.join(archive, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
	});
});
