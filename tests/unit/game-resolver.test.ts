import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	GAME_SEED,
	type GameCacheManifest,
	type GameCatalogPort,
	GameResolutionError,
	GameResolver,
} from "../../src/adapters/game-resolver.js";
import { canonicalJson } from "../../src/protocol/canonical-json.js";

const GAME_ID = "ls20-9607627b";
const LOCATOR = `arc-agi://public/${GAME_ID}?sdk=0.9.9`;
const TREE_DIGEST = "e570152a34ae99af6f71dc6ec1661e35435ea8f447ba0144624bdecc0cd57261";
const FIXTURE_ENVIRONMENT = fileURLToPath(new URL("../fixtures/game/ls20-9607627b/environment", import.meta.url));

class FixtureCatalog implements GameCatalogPort {
	calls = 0;
	readonly destinations: string[] = [];

	constructor(
		private readonly prepare?: (destination: string) => Promise<void>,
		private readonly receipt: Readonly<{ gameId: string; sourceLocator: string }> = {
			gameId: GAME_ID,
			sourceLocator: LOCATOR,
		},
	) {}

	async fetch(gameId: string, sourceLocator: string, destination: string) {
		this.calls += 1;
		this.destinations.push(destination);
		expect(gameId).toBe(GAME_ID);
		expect(sourceLocator).toBe(LOCATOR);
		expect(destination).toContain(`${path.sep}.staging-`);
		await cp(FIXTURE_ENVIRONMENT, destination, { recursive: true });
		await this.prepare?.(destination);
		return this.receipt;
	}
}

function tempCache(label: string): Promise<string> {
	return mkdtemp(path.join(tmpdir(), `pi-arc-game-${label}-`));
}

async function publishFixture(label: string): Promise<{
	cacheRoot: string;
	resolver: GameResolver;
	manifestPath: string;
	contentRoot: string;
	environmentRoot: string;
}> {
	const cacheRoot = await tempCache(label);
	const resolver = new GameResolver(new FixtureCatalog());
	const result = await resolver.resolve({ gameId: GAME_ID, cacheRoot, offline: false });
	return {
		cacheRoot,
		resolver,
		manifestPath: path.join(result.contentRoot, "manifest.json"),
		contentRoot: result.contentRoot,
		environmentRoot: result.environmentRoot,
	};
}

async function readManifest(file: string): Promise<GameCacheManifest> {
	return JSON.parse(await readFile(file, "utf8")) as GameCacheManifest;
}

async function fixtureManifest(): Promise<GameCacheManifest> {
	const entries = await Promise.all(
		["environment.py", "metadata.json"].map(async (entryPath) => {
			const bytes = await readFile(path.join(FIXTURE_ENVIRONMENT, entryPath));
			return {
				path: entryPath,
				size: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			};
		}),
	);
	return {
		schema: "pi-arc.game-cache.v1",
		sourceLocator: LOCATOR,
		gameId: GAME_ID,
		sdkVersion: "0.9.9",
		runtimeVersion: "3.12.9",
		seed: GAME_SEED,
		treeDigest: TREE_DIGEST,
		entries,
	};
}

describe("Game resolver", () => {
	it("通过 staging 发布 canonical cache，并在 offline hit 时重新验证", async () => {
		const cacheRoot = await tempCache("publish");
		const catalog = new FixtureCatalog();
		const resolver = new GameResolver(catalog);
		const downloaded = await resolver.resolve({ gameId: GAME_ID, cacheRoot, offline: false });

		expect(downloaded).toMatchObject({
			gameId: GAME_ID,
			sourceLocator: LOCATOR,
			cacheHit: false,
			treeDigest: TREE_DIGEST,
		});
		expect(downloaded.contentRoot).toBe(path.join(cacheRoot, GAME_ID, downloaded.treeDigest));
		expect(downloaded.manifest.entries.map((entry) => entry.path)).toEqual(["environment.py", "metadata.json"]);
		expect(await readFile(path.join(downloaded.contentRoot, "manifest.json"), "utf8")).toBe(
			canonicalJson(downloaded.manifest),
		);
		expect(catalog.calls).toBe(1);
		expect(catalog.destinations).toHaveLength(1);
		expect((await lstat(downloaded.contentRoot)).isDirectory()).toBe(true);

		const offline = await resolver.resolve({ gameId: GAME_ID, cacheRoot, offline: true });
		expect(offline).toMatchObject({ treeDigest: downloaded.treeDigest, cacheHit: true });
		expect(catalog.calls).toBe(1);
		expect((await readdir(path.join(cacheRoot, GAME_ID))).some((name) => name.startsWith(".staging-"))).toBe(false);
	});

	it("并发 publisher 已发布相同 digest 时复用既有不可变目录", async () => {
		const cacheRoot = await tempCache("concurrent");
		const catalog = new FixtureCatalog(async (destination) => {
			const gameRoot = path.dirname(path.dirname(destination));
			const target = path.join(gameRoot, TREE_DIGEST);
			await mkdir(path.join(target, "environment"), { recursive: true });
			await cp(FIXTURE_ENVIRONMENT, path.join(target, "environment"), { recursive: true });
			await writeFile(path.join(target, "manifest.json"), canonicalJson(await fixtureManifest()), "utf8");
		});
		const resolved = await new GameResolver(catalog).resolve({ gameId: GAME_ID, cacheRoot, offline: false });
		expect(resolved).toMatchObject({ treeDigest: TREE_DIGEST, cacheHit: true });
		expect((await readdir(path.join(cacheRoot, GAME_ID))).some((name) => name.startsWith(".staging-"))).toBe(false);
	});

	it("拒绝非完整 ID、offline miss，并且不扫描旧项目副本", async () => {
		const cacheRoot = await tempCache("offline");
		const oldProject = path.join(path.dirname(cacheRoot), "memo-arc", GAME_ID);
		await mkdir(oldProject, { recursive: true });
		await cp(FIXTURE_ENVIRONMENT, oldProject, { recursive: true });
		const catalog = new FixtureCatalog();
		const resolver = new GameResolver(catalog);

		for (const gameId of ["ls20", "ls20-latest", "../ls20-9607627b", "LS20-9607627B"]) {
			await expect(resolver.resolve({ gameId, cacheRoot, offline: true })).rejects.toMatchObject({
				code: "invalid_game_id",
			});
		}
		await expect(resolver.resolve({ gameId: GAME_ID, cacheRoot, offline: true })).rejects.toMatchObject({
			code: "game_cache_miss",
		});
		expect(catalog.calls).toBe(0);
	});

	it("拒绝 unlisted file、内容 digest 漂移和 manifest path traversal", async () => {
		const unlisted = await publishFixture("unlisted");
		await writeFile(path.join(unlisted.environmentRoot, "extra.txt"), "unexpected", "utf8");
		await expect(
			unlisted.resolver.resolve({ gameId: GAME_ID, cacheRoot: unlisted.cacheRoot, offline: true }),
		).rejects.toMatchObject({ code: "cache_corrupt" });

		const drift = await publishFixture("digest");
		await writeFile(path.join(drift.environmentRoot, "metadata.json"), "{}\n", "utf8");
		await expect(
			drift.resolver.resolve({ gameId: GAME_ID, cacheRoot: drift.cacheRoot, offline: true }),
		).rejects.toMatchObject({ code: "cache_corrupt" });

		const traversal = await publishFixture("traversal");
		const manifest = await readManifest(traversal.manifestPath);
		const first = manifest.entries[0];
		if (first === undefined) throw new Error("fixture manifest has no entries");
		manifest.entries[0] = { ...first, path: "../environment.py" };
		await writeFile(traversal.manifestPath, canonicalJson(manifest), "utf8");
		await expect(
			traversal.resolver.resolve({ gameId: GAME_ID, cacheRoot: traversal.cacheRoot, offline: true }),
		).rejects.toMatchObject({ code: "cache_corrupt" });
	});

	it("拒绝 cache root、Game tree 和 Environment tree 中的 symlink", async () => {
		const realRoot = await tempCache("real-root");
		const linkedRoot = `${realRoot}-link`;
		await symlink(realRoot, linkedRoot);
		await expect(
			new GameResolver(new FixtureCatalog()).resolve({ gameId: GAME_ID, cacheRoot: linkedRoot, offline: true }),
		).rejects.toMatchObject({ code: "cache_corrupt" });

		const linkedGameCache = await tempCache("linked-game");
		const externalGame = await tempCache("external-game");
		await symlink(externalGame, path.join(linkedGameCache, GAME_ID));
		await expect(
			new GameResolver(new FixtureCatalog()).resolve({ gameId: GAME_ID, cacheRoot: linkedGameCache, offline: true }),
		).rejects.toMatchObject({ code: "cache_corrupt" });

		const stagedLink = new GameResolver(
			new FixtureCatalog(async (destination) => {
				await symlink(path.join(destination, "metadata.json"), path.join(destination, "linked.json"));
			}),
		);
		await expect(
			stagedLink.resolve({ gameId: GAME_ID, cacheRoot: await tempCache("staged-link"), offline: false }),
		).rejects.toMatchObject({ code: "cache_corrupt" });
	});

	it("拒绝多个 published digest 和非 digest cache entry", async () => {
		const conflict = await publishFixture("conflict");
		await mkdir(path.join(conflict.cacheRoot, GAME_ID, "0".repeat(64)));
		await expect(
			conflict.resolver.resolve({ gameId: GAME_ID, cacheRoot: conflict.cacheRoot, offline: true }),
		).rejects.toMatchObject({ code: "cache_conflict" });

		const invalid = await tempCache("invalid-entry");
		await mkdir(path.join(invalid, GAME_ID), { recursive: true });
		await writeFile(path.join(invalid, GAME_ID, "latest"), "not immutable", "utf8");
		await expect(
			new GameResolver(new FixtureCatalog()).resolve({ gameId: GAME_ID, cacheRoot: invalid, offline: true }),
		).rejects.toMatchObject({ code: "cache_corrupt" });

		const badStaging = await tempCache("bad-staging");
		await mkdir(path.join(badStaging, GAME_ID), { recursive: true });
		await writeFile(path.join(badStaging, GAME_ID, ".staging-broken"), "not a directory", "utf8");
		await expect(
			new GameResolver(new FixtureCatalog()).resolve({ gameId: GAME_ID, cacheRoot: badStaging, offline: true }),
		).rejects.toMatchObject({ code: "cache_corrupt" });
	});

	it("拒绝 catalog identity mismatch、下载失败和不完整 fixture，并清理 staging", async () => {
		const mismatchRoot = await tempCache("catalog-mismatch");
		const mismatch = new GameResolver(
			new FixtureCatalog(undefined, { gameId: "zz99-00000000", sourceLocator: LOCATOR }),
		);
		await expect(
			mismatch.resolve({ gameId: GAME_ID, cacheRoot: mismatchRoot, offline: false }),
		).rejects.toMatchObject({
			code: "catalog_mismatch",
		});
		expect(await readdir(path.join(mismatchRoot, GAME_ID))).toEqual([]);

		const failingRoot = await tempCache("catalog-failure");
		const failing: GameCatalogPort = {
			fetch: () => Promise.reject(new Error("injected catalog failure")),
		};
		await expect(
			new GameResolver(failing).resolve({ gameId: GAME_ID, cacheRoot: failingRoot, offline: false }),
		).rejects.toMatchObject({ code: "catalog_failed" });
		expect(await readdir(path.join(failingRoot, GAME_ID))).toEqual([]);

		const incomplete = new GameResolver(
			new FixtureCatalog(async (destination) => {
				await rename(path.join(destination, "metadata.json"), path.join(destination, "renamed.json"));
			}),
		);
		await expect(
			incomplete.resolve({ gameId: GAME_ID, cacheRoot: await tempCache("incomplete"), offline: false }),
		).rejects.toMatchObject({ code: "cache_corrupt" });

		const noPython = new GameResolver(
			new FixtureCatalog(async (destination) => {
				await rename(path.join(destination, "environment.py"), path.join(destination, "environment.txt"));
			}),
		);
		await expect(
			noPython.resolve({ gameId: GAME_ID, cacheRoot: await tempCache("no-python"), offline: false }),
		).rejects.toMatchObject({ code: "cache_corrupt" });
	});

	it("拒绝非 canonical manifest 与冲突 entry 顺序", async () => {
		const noncanonical = await publishFixture("noncanonical");
		const manifest = await readManifest(noncanonical.manifestPath);
		await writeFile(noncanonical.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
		await expect(
			noncanonical.resolver.resolve({ gameId: GAME_ID, cacheRoot: noncanonical.cacheRoot, offline: true }),
		).rejects.toBeInstanceOf(GameResolutionError);

		const unsorted = await publishFixture("unsorted");
		const unsortedManifest = await readManifest(unsorted.manifestPath);
		unsortedManifest.entries.reverse();
		await writeFile(unsorted.manifestPath, canonicalJson(unsortedManifest), "utf8");
		await expect(
			unsorted.resolver.resolve({ gameId: GAME_ID, cacheRoot: unsorted.cacheRoot, offline: true }),
		).rejects.toMatchObject({ code: "cache_corrupt" });

		const invalidJson = await publishFixture("invalid-json");
		await writeFile(invalidJson.manifestPath, "{\n", "utf8");
		await expect(
			invalidJson.resolver.resolve({ gameId: GAME_ID, cacheRoot: invalidJson.cacheRoot, offline: true }),
		).rejects.toMatchObject({ code: "cache_corrupt" });

		const wrongBinding = await publishFixture("wrong-binding");
		const wrongManifest = await readManifest(wrongBinding.manifestPath);
		wrongManifest.gameId = "zz99-00000000";
		await writeFile(wrongBinding.manifestPath, canonicalJson(wrongManifest), "utf8");
		await expect(
			wrongBinding.resolver.resolve({ gameId: GAME_ID, cacheRoot: wrongBinding.cacheRoot, offline: true }),
		).rejects.toMatchObject({ code: "cache_corrupt" });
	});
});
