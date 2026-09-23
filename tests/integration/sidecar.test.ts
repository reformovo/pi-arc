import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SidecarClient } from "../../src/adapters/sidecar-client.js";

const clients: SidecarClient[] = [];

async function createClient(spawnEnv: NodeJS.ProcessEnv = {}): Promise<{ client: SidecarClient; cacheRoot: string }> {
	const root = await mkdtemp(path.join(os.tmpdir(), "pi-arc-sidecar-"));
	const environmentRoot = path.resolve("tests/fixtures/sidecar");
	const cacheRoot = path.join(root, "receipt-cache");
	await mkdir(cacheRoot, { recursive: true });
	const client = new SidecarClient({
		environmentRoot,
		cacheRoot,
		gameId: "ls20-9607627b",
		sourceLocator: "arc-agi://public/ls20-9607627b?sdk=0.9.9",
		treeDigest: "a".repeat(64),
		seed: 42,
		pythonPath: path.resolve("python"),
		spawnEnv: { PI_ARC_TEST_SECRET: "SIDEcar-secret-must-not-enter-child", ...spawnEnv },
	});
	clients.push(client);
	return { client, cacheRoot };
}

afterEach(async () => {
	for (const client of clients.splice(0)) await client.close();
});

describe("Python Environment sidecar wire", () => {
	it("opens, commits a complete receipt, and deduplicates actionId", async () => {
		const { client } = await createClient();
		const opened = await client.open();
		expect(opened.environmentInstanceId).toEqual(expect.any(String));
		const anchor = opened.anchor as Record<string, unknown>;
		const payload = {
			environmentInstanceId: opened.environmentInstanceId,
			baseTurn: anchor.turn,
			baseObservationDigest: anchor.observationDigest,
			actionId: "action-1",
			action: { name: "ACTION1", data: {} },
		};
		const first = await client.request("submit_action", payload);
		const receipt = first.receipt as Record<string, unknown>;
		expect(receipt.status).toBe("complete");
		expect(receipt.observation).toBeDefined();
		expect(receipt.frames).toEqual([
			[
				[1, 1],
				[2, 3],
			],
		]);
		const duplicate = await client.request("submit_action", payload);
		expect(duplicate.receipt).toEqual(receipt);
		const lookup = await client.request("lookup_action", {
			environmentInstanceId: opened.environmentInstanceId,
			actionId: "action-1",
		});
		expect(lookup.receipt).toEqual(receipt);
	});

	it("rejects stale anchors and conflicting action parameters", async () => {
		const { client } = await createClient();
		const opened = await client.open();
		const anchor = opened.anchor as Record<string, unknown>;
		const base = {
			environmentInstanceId: opened.environmentInstanceId,
			baseTurn: anchor.turn,
			baseObservationDigest: anchor.observationDigest,
			actionId: "action-2",
			action: { name: "ACTION1", data: {} },
		};
		await client.request("submit_action", base);
		await expect(
			client.request("submit_action", { ...base, action: { name: "ACTION7", data: {} } }),
		).rejects.toMatchObject({ code: "action_conflict" });
		await expect(client.request("submit_action", { ...base, actionId: "action-3" })).rejects.toMatchObject({
			code: "anchor_conflict",
		});
	});

	it("does not expose secrets or the artifact root to Python", async () => {
		const { client } = await createClient();
		const opened = await client.open();
		expect(opened.environmentInstanceId).toEqual(expect.any(String));
	});

	it("durably records pending before an injected process crash", async () => {
		const { client, cacheRoot } = await createClient({ PI_ARC_SIDECAR_CRASH_AFTER_ACCEPT: "1" });
		const opened = await client.open();
		const anchor = opened.anchor as Record<string, unknown>;
		await expect(
			client.request("submit_action", {
				environmentInstanceId: opened.environmentInstanceId,
				baseTurn: anchor.turn,
				baseObservationDigest: anchor.observationDigest,
				actionId: "crash-action",
				action: { name: "ACTION1", data: {} },
			}),
		).rejects.toBeDefined();
		const state = JSON.parse(await readFile(path.join(cacheRoot, "sidecar-state.json"), "utf8")) as Record<
			string,
			unknown
		>;
		expect((state.pending as Record<string, unknown>).actionId).toBe("crash-action");
	});
});
