/** 使用真实本地 sidecar 与 faux Models 验证 WP-09 的 SDK/CLI 离线闭环。 */

import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../../src/adapters/artifact-store.js";
import { canonicalJsonDigest } from "../../src/adapters/sha256.js";
import { SidecarClient } from "../../src/adapters/sidecar-client.js";
import { VisualPngPublisher } from "../../src/adapters/visual-png.js";
import { RunController } from "../../src/application/run-controller.js";
import { runCli } from "../../src/composition/cli.js";
import { OfficialGameCatalog } from "../../src/composition/official-catalog.js";
import { createHostWithPorts } from "../../src/composition/pi-arc-host.js";

const GAME_ID = "ls20-9607627b";
const source = fileURLToPath(new URL("../fixtures/sidecar", import.meta.url));
const lifecycleSource = fileURLToPath(new URL("../fixtures/lifecycle", import.meta.url));
const now = () => "2026-09-24T00:00:00Z";

async function fixture(environmentSource = source, crashAfterAccept = false) {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-arc-wp09-"));
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	let nextId = 0;
	let fetches = 0;
	const host = createHostWithPorts(models, {
		now,
		newId: () => `run-${++nextId}`,
		...(crashAfterAccept
			? {
					sidecar: (options: ConstructorParameters<typeof SidecarClient>[0]) =>
						new SidecarClient({ ...options, spawnEnv: { PI_ARC_SIDECAR_CRASH_AFTER_ACCEPT: "1" } }),
				}
			: {}),
		catalog: {
			fetch: async (gameId, sourceLocator, destination) => {
				fetches += 1;
				await cp(environmentSource, destination, { recursive: true });
				return { gameId, sourceLocator };
			},
		},
	});
	return {
		root,
		faux,
		host,
		get fetches() {
			return fetches;
		},
		request: (artifactRoot = path.join(root, "artifacts")) => ({
			gameId: GAME_ID,
			gameCache: path.join(root, "game-cache"),
			provider: faux.provider.id,
			modelId: faux.getModel().id,
			artifactRoot,
			gameOffline: false,
		}),
	};
}

function winResponses(faux: Awaited<ReturnType<typeof fixture>>["faux"]): void {
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("play", { action: "ACTION7" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("done"),
	]);
}

describe("WP-09 offline host", () => {
	it("discards SDK fetching observations and starts a separate credential-free Run", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "pi-arc-sdk-fetch-"));
		const sdkRoot = path.join(root, "sdk");
		await mkdir(sdkRoot);
		const metadata = await readFile(path.join(source, "metadata.json"), "utf8");
		const environment = await readFile(path.join(source, "environment.py"), "utf8");
		const guarded = `import os\nfrom pathlib import Path\nassert 'ARC_API_KEY' not in os.environ\nassert 'CUSTOM_PROVIDER_CREDENTIAL' not in os.environ\nassert not Path('.env').exists()\n${environment}`;
		// fake SDK 的获取 wrapper 故意给出伪 WIN；正式 Run 必须重新 reset 得到 NOT_FINISHED。
		await writeFile(
			path.join(sdkRoot, "arc_agi.py"),
			[
				"import json, os",
				"from pathlib import Path",
				"from types import SimpleNamespace",
				"assert not Path('.env').exists()",
				"class OperationMode: NORMAL = 'normal'",
				"class Arcade:",
				"    def __init__(self, **options):",
				"        assert options['arc_api_key'] == 'fake-arc-key'",
				"        assert options['logger'].disabled",
				"        assert 'CUSTOM_PROVIDER_CREDENTIAL' not in os.environ",
				"        assert 'PI_SESSION' not in os.environ",
				"        self.root = Path(options['environments_dir'])",
				"    def make(self, game_id, **options):",
				"        self.root.mkdir()",
				`        files = json.loads(${JSON.stringify(JSON.stringify({ "metadata.json": metadata, "environment.py": guarded }))})`,
				"        for name, content in files.items(): (self.root / name).write_text(content)",
				"        return SimpleNamespace(environment_info=SimpleNamespace(game_id=game_id, local_dir=str(self.root)), observation_space={'state': 'WIN'})",
			].join("\n"),
		);
		vi.stubEnv("ARC_API_KEY", "fake-arc-key");
		vi.stubEnv("CUSTOM_PROVIDER_CREDENTIAL", "fake-model-secret");
		vi.stubEnv("PI_SESSION", "private-session");
		const models = createModels();
		const faux = fauxProvider();
		models.setProvider(faux.provider);
		winResponses(faux);
		let receiptRoot = "";
		const host = createHostWithPorts(models, {
			now,
			newId: () => "separate-run",
			catalog: new OfficialGameCatalog(
				path.resolve(".venv/bin/python"),
				[sdkRoot, path.resolve("python")].join(path.delimiter),
			),
			sidecar: (options) => {
				receiptRoot = options.cacheRoot;
				return new SidecarClient(options);
			},
		});
		try {
			const result = await host.run({
				gameId: GAME_ID,
				gameCache: path.join(root, "cache"),
				provider: faux.provider.id,
				modelId: faux.getModel().id,
				artifactRoot: path.join(root, "artifacts"),
			});
			expect(result).toMatchObject({
				status: "terminated",
				result: { outcomeClass: "win", lastCommittedTurn: 1, audit: { ok: true } },
			});
			const initial = JSON.parse(await readFile(path.join(root, "artifacts/frames/t000000/f000000.json"), "utf8"));
			expect(initial).toBeDefined();
			const records = await readFile(path.join(root, "artifacts/domain.jsonl"), "utf8");
			expect(records).toContain("NOT_FINISHED");
			expect(records).not.toContain("fake-arc-key");
			expect(records).not.toContain("fake-model-secret");
			expect(receiptRoot).not.toContain("artifacts");
			await expect(stat(receiptRoot)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			vi.unstubAllEnvs();
			await rm(root, { recursive: true, force: true });
		}
	});
	it("cleans the receipt directory when sidecar construction fails before Run start", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "pi-arc-startup-cleanup-"));
		const models = createModels();
		const faux = fauxProvider();
		models.setProvider(faux.provider);
		let receiptRoot = "";
		const host = createHostWithPorts(models, {
			catalog: {
				fetch: async (gameId, sourceLocator, destination) => {
					await cp(source, destination, { recursive: true });
					return { gameId, sourceLocator };
				},
			},
			sidecar: (options) => {
				receiptRoot = options.cacheRoot;
				throw new Error("constructor failed");
			},
		});
		try {
			await expect(
				host.run({
					gameId: GAME_ID,
					gameCache: path.join(root, "cache"),
					provider: faux.provider.id,
					modelId: faux.getModel().id,
					artifactRoot: path.join(root, "artifacts"),
				}),
			).resolves.toEqual({ status: "rejected", reason: "startup_failed" });
			await expect(stat(receiptRoot)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("resume of a nonterminal archive classifies a lost prior Environment instance", async () => {
		const setup = await fixture();
		const root = path.join(setup.root, "incomplete-run");
		const sidecar = new SidecarClient({
			environmentRoot: source,
			cacheRoot: path.join(setup.root, "sidecar-state"),
			gameId: GAME_ID,
			sourceLocator: `arc-agi://public/${GAME_ID}?sdk=0.9.9`,
			treeDigest: "a".repeat(64),
			seed: 42,
			pythonPath: path.resolve("python"),
		});
		const manifest = {
			schema: "pi-arc.run-manifest.v1" as const,
			runId: "incomplete-run",
			game: { id: GAME_ID, sourceLocator: `arc-agi://public/${GAME_ID}?sdk=0.9.9`, treeDigest: "a".repeat(64) },
			model: { provider: "faux", modelId: "faux-model" },
			runtime: { piAgentCore: "0.86.0", piAi: "0.86.0" },
			coordinates: 1024,
			seed: 42,
			config: { actionBudget: 2000, gameOffline: true },
		};
		try {
			await RunController.start(
				{ manifest, sessionId: "session", laneId: "arc" },
				{
					artifacts: new ArtifactStore(root),
					environment: sidecar,
					visuals: new VisualPngPublisher(root),
					now,
					digest: canonicalJsonDigest,
				},
			);
		} finally {
			await sidecar.close();
		}
		const resumed = await setup.host.resume({ artifactRoot: root });
		expect(resumed).toMatchObject({
			status: "terminated",
			result: { outcomeClass: "non_success", terminationReason: "environment_lost", audit: { ok: true } },
		});
		const events = [];
		for await (const event of setup.host.readEvents(root)) events.push(event);
		expect(events.at(-1)?.type).toBe("run.completed");
		expect(events.map((event) => event.type)).toContain("run.resumed");
	});

	it("stops at the configured Action budget without inventing WIN", async () => {
		const setup = await fixture();
		setup.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("play", { action: "ACTION1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		const result = await setup.host.run({ ...setup.request(), actionBudget: 1 });
		expect(result).toMatchObject({
			status: "terminated",
			result: { outcomeClass: "non_success", terminationReason: "action_budget_exhausted", lastCommittedTurn: 1 },
		});
	});

	it("turns a provider failure into model_failure without submitting an Action", async () => {
		const setup = await fixture();
		setup.faux.setResponses([fauxAssistantMessage("provider failed", { stopReason: "error" })]);
		const result = await setup.host.run(setup.request());
		expect(result).toMatchObject({
			status: "terminated",
			result: { outcomeClass: "non_success", terminationReason: "model_failure", lastCommittedTurn: 0 },
		});
		const domain = await readFile(path.join(setup.root, "artifacts", "domain.jsonl"), "utf8");
		expect(domain).not.toContain('"recordType":"action.intent"');
	});

	it("classifies a sidecar crash with pending Action as Unknown Outcome", async () => {
		const setup = await fixture(source, true);
		setup.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("play", { action: "ACTION1" })], { stopReason: "toolUse" }),
		]);
		const result = await setup.host.run(setup.request());
		expect(result).toMatchObject({
			status: "terminated",
			result: { outcomeClass: "unknown_outcome", terminationReason: "unknown_action_outcome" },
		});
	});

	it("classifies model no-progress as a known non-success and preserves the last Turn", async () => {
		const setup = await fixture();
		setup.faux.setResponses([
			fauxAssistantMessage("no action"),
			fauxAssistantMessage("still no action"),
			fauxAssistantMessage("done"),
		]);
		const result = await setup.host.run(setup.request());
		expect(result).toMatchObject({
			status: "terminated",
			result: { outcomeClass: "non_success", terminationReason: "model_no_progress", lastCommittedTurn: 0 },
		});
	});

	it("reports archive tampering as audit failure without rewriting terminal evidence", async () => {
		const setup = await fixture();
		winResponses(setup.faux);
		const request = setup.request();
		const result = await setup.host.run(request);
		expect(result.status).toBe("terminated");
		const framePath = path.join(request.artifactRoot, "frames", "t000001", "f000000.json");
		const before = await readFile(framePath, "utf8");
		const { writeFile } = await import("node:fs/promises");
		await writeFile(framePath, before.replace('"contentDigest":"', '"contentDigest":"f'), "utf8");
		const terminalBefore = await readFile(path.join(request.artifactRoot, "terminal.json"), "utf8");
		const output: string[] = [];
		const code = await runCli(
			["audit", "--artifacts", request.artifactRoot],
			setup.host,
			{ stdout: (value) => output.push(value), stderr: () => {} },
			now,
		);
		expect(code).toBe(30);
		expect((await setup.host.audit(request.artifactRoot)).ok).toBe(false);
		expect(output.join("").match(/"type":"audit.completed"/g)).toHaveLength(1);
		expect(await readFile(path.join(request.artifactRoot, "terminal.json"), "utf8")).toBe(terminalBefore);
	});

	it("crosses GAME_OVER/RESET boundary before the authoritative WIN", async () => {
		const setup = await fixture(lifecycleSource);
		setup.faux.setResponses([
			fauxAssistantMessage([fauxToolCall("play", { action: "ACTION1" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("observed failure"),
			fauxAssistantMessage([fauxToolCall("play", { action: "RESET", retry_state: "try the other action" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("reset complete"),
			fauxAssistantMessage([fauxToolCall("play", { action: "ACTION7" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		const result = await setup.host.run(setup.request());
		expect(result).toMatchObject({
			status: "terminated",
			result: { outcomeClass: "win", terminationReason: "WIN", lastCommittedTurn: 3 },
		});
		const domain = await readFile(path.join(setup.root, "artifacts", "domain.jsonl"), "utf8");
		expect(domain).toContain('"boundaryPending":true');
		expect(domain).toContain('"recordType":"context.boundary"');
	});

	it("starts a real sidecar, commits WIN and exposes a read-only SDK audit/event stream", async () => {
		const setup = await fixture();
		winResponses(setup.faux);
		const request = setup.request();
		const outcome = await setup.host.run(request);
		expect(outcome.status).toBe("terminated");
		if (outcome.status !== "terminated") return;
		expect(outcome.result).toMatchObject({
			outcomeClass: "win",
			terminationReason: "WIN",
			lastCommittedTurn: 1,
			audit: { ok: true },
		});
		const events = [];
		for await (const event of setup.host.readEvents(request.artifactRoot)) events.push(event);
		expect(events[0]?.type).toBe("run.started");
		expect(events.at(-1)?.type).toBe("run.completed");
		expect(events.map((event) => event.type)).toContain("environment.receipt");
		expect((await setup.host.audit(request.artifactRoot)).ok).toBe(true);
		const terminalBefore = await readFile(path.join(request.artifactRoot, "terminal.json"), "utf8");
		const resumed = await setup.host.resume({ artifactRoot: request.artifactRoot });
		expect(resumed).toMatchObject({ status: "terminated", result: { outcomeClass: "win" } });
		expect(await readFile(path.join(request.artifactRoot, "terminal.json"), "utf8")).toBe(terminalBefore);
		expect(setup.fetches).toBe(1);
	});

	it("CLI and SDK classify the same offline fixture and preserve JSONL final event", async () => {
		const setup = await fixture();
		winResponses(setup.faux);
		const request = setup.request();
		const stdout: string[] = [];
		const stderr: string[] = [];
		const code = await runCli(
			[
				"run",
				"--game-id",
				request.gameId,
				"--game-cache",
				request.gameCache,
				"--provider",
				request.provider,
				"--model",
				request.modelId,
				"--artifacts",
				request.artifactRoot,
			],
			setup.host,
			{ stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
			now,
		);
		expect(code).toBe(0);
		expect(stderr).toEqual([]);
		const lines = stdout
			.join("")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { type: string; sequence: number });
		expect(lines.at(-1)?.type).toBe("run.completed");
		expect(lines.map((line) => line.sequence)).toEqual(lines.map((_, index) => index + 1));
		const auditOutput: string[] = [];
		expect(
			await runCli(
				["audit", "--artifacts", request.artifactRoot],
				setup.host,
				{ stdout: (value) => auditOutput.push(value), stderr: () => {} },
				now,
			),
		).toBe(0);
		expect((JSON.parse(auditOutput.at(-1) ?? "{}") as { type: string }).type).toBe("audit.completed");
	});

	it("rejects missing offline Game and invalid CLI flags before creating a Run", async () => {
		const setup = await fixture();
		expect(await setup.host.run({ ...setup.request(), gameOffline: true })).toEqual({
			status: "rejected",
			reason: "game_cache_miss",
		});
		expect(setup.fetches).toBe(0);
		const output: string[] = [];
		expect(
			await runCli(
				["run", "--game-id", GAME_ID],
				setup.host,
				{ stdout: (value) => output.push(value), stderr: () => {} },
				now,
			),
		).toBe(2);
		expect((JSON.parse(output[0] ?? "{}") as { type: string }).type).toBe("run.rejected");
	});

	it("rejects invalid SDK input, symlink artifacts and unconfigured models before any Action", async () => {
		const setup = await fixture();
		const request = setup.request();
		expect(await setup.host.run({ ...request, gameId: "ls20" })).toEqual({
			status: "rejected",
			reason: "invalid_request",
		});
		expect(await setup.host.run({ ...request, actionBudget: 0 })).toEqual({
			status: "rejected",
			reason: "invalid_request",
		});
		expect(await setup.host.run({ ...request, signal: AbortSignal.abort() })).toEqual({
			status: "rejected",
			reason: "cancelled_before_start",
		});
		const link = path.join(setup.root, "linked-artifacts");
		await symlink(setup.root, link);
		expect(await setup.host.run({ ...request, artifactRoot: link })).toEqual({
			status: "rejected",
			reason: "artifact_unavailable",
		});
		expect(setup.fetches).toBe(0);
		expect(await setup.host.run({ ...request, provider: "not-configured" })).toEqual({
			status: "rejected",
			reason: "model_unavailable",
		});
		expect(await setup.host.run({ ...request, thinkingLevel: "max" })).toEqual({
			status: "rejected",
			reason: "thinking_unsupported",
		});
		expect(setup.fetches).toBe(1);
	});

	it("rejects malformed resume archives and honors readEvents afterSequence", async () => {
		const setup = await fixture();
		expect(await setup.host.resume({ artifactRoot: path.join(setup.root, "missing") })).toEqual({
			status: "rejected",
			reason: "archive_invalid",
		});
		const bad = path.join(setup.root, "bad");
		const { mkdir } = await import("node:fs/promises");
		await mkdir(bad);
		await writeFile(path.join(bad, "manifest.json"), "{}", "utf8");
		expect(await setup.host.resume({ artifactRoot: bad })).toEqual({ status: "rejected", reason: "archive_invalid" });
		winResponses(setup.faux);
		const request = setup.request();
		const run = await setup.host.run(request);
		expect(run.status).toBe("terminated");
		const all = [];
		for await (const event of setup.host.readEvents(request.artifactRoot)) all.push(event);
		const tail = [];
		for await (const event of setup.host.readEvents(request.artifactRoot, all.length - 1)) tail.push(event);
		expect(tail).toEqual(all.slice(-1));
	});
});
