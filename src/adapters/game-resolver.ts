/**
 * 官方 Game catalog 与本地不可变 cache 之间的可信发布边界。
 *
 * resolver 自身不包含网络 client，也不加载下载的 Python；唯一外部效果来自
 * 注入的 catalog port。所有内容先进入 staging，经完整 tree 校验后才 rename 发布。
 */

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, type JsonValue } from "../protocol/canonical-json.js";

export const ARC_AGI_SDK_VERSION = "0.9.9";
export const PYTHON_RUNTIME_VERSION = "3.12.9";
export const GAME_SEED = 42;

export const FULL_GAME_ID = /^[a-z0-9]{4}-[A-Za-z0-9]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Game cache manifest 中一项经过摘要的 Environment 文件。 */
export interface GameCacheEntry extends Record<string, JsonValue> {
	path: string;
	size: number;
	sha256: string;
}

/** `pi-arc.game-cache.v1` 的规范化、write-once manifest。 */
export interface GameCacheManifest extends Record<string, JsonValue> {
	schema: "pi-arc.game-cache.v1";
	sourceLocator: string;
	gameId: string;
	sdkVersion: typeof ARC_AGI_SDK_VERSION;
	runtimeVersion: typeof PYTHON_RUNTIME_VERSION;
	seed: typeof GAME_SEED;
	treeDigest: string;
	entries: GameCacheEntry[];
}

/** catalog 完成 staging 写入后返回的来源确认。 */
export interface GameCatalogReceipt {
	gameId: string;
	sourceLocator: string;
}

/**
 * official catalog adapter 的唯一 port。
 * 实现只能把指定 Game 写入 destination，不得直接发布到 digest directory。
 */
export interface GameCatalogPort {
	fetch(gameId: string, sourceLocator: string, destination: string): Promise<GameCatalogReceipt>;
}

/** resolver 的单次请求；offline 模式绝不调用 catalog port。 */
export interface ResolveGameRequest {
	gameId: string;
	cacheRoot: string;
	offline: boolean;
}

/** 已重新验证、可交给后续 sidecar 的不可变 Game cache binding。 */
export interface ResolvedGame {
	gameId: string;
	sourceLocator: string;
	treeDigest: string;
	contentRoot: string;
	environmentRoot: string;
	manifest: GameCacheManifest;
	cacheHit: boolean;
}

export type GameResolutionErrorCode =
	| "invalid_game_id"
	| "game_cache_miss"
	| "cache_corrupt"
	| "cache_conflict"
	| "catalog_mismatch"
	| "catalog_failed";

/** Game 获取在 Run 启动前 fail closed 的稳定内部错误。 */
export class GameResolutionError extends Error {
	readonly code: GameResolutionErrorCode;

	constructor(code: GameResolutionErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}

function sourceLocator(gameId: string): string {
	return `arc-agi://public/${gameId}?sdk=${ARC_AGI_SDK_VERSION}`;
}

function isMissing(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keysAre(record: Record<string, unknown>, expected: readonly string[]): boolean {
	return Object.keys(record).sort().join("\u0000") === [...expected].sort().join("\u0000");
}

function compareCodePoints(left: string, right: string): number {
	const leftPoints = [...left];
	const rightPoints = [...right];
	for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
		const leftPoint = leftPoints[index];
		const rightPoint = rightPoints[index];
		if (leftPoint === rightPoint) continue;
		return (leftPoint?.codePointAt(0) ?? 0) - (rightPoint?.codePointAt(0) ?? 0);
	}
	return leftPoints.length - rightPoints.length;
}

function sha256(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function digestEntries(entries: readonly GameCacheEntry[]): string {
	return sha256(canonicalJson(entries as GameCacheEntry[]));
}

function safeRelativePosix(candidate: string): boolean {
	if (candidate.length === 0 || candidate.startsWith("/") || candidate.includes("\\")) return false;
	const segments = candidate.split("/");
	return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

async function assertDirectory(directory: string, label: string, create: boolean): Promise<void> {
	try {
		const info = await lstat(directory);
		if (info.isSymbolicLink() || !info.isDirectory()) {
			throw new GameResolutionError("cache_corrupt", `${label} must be a real directory`);
		}
		return;
	} catch (error) {
		if (!isMissing(error) || !create) throw error;
	}
	await mkdir(directory, { recursive: true });
	const created = await lstat(directory);
	if (created.isSymbolicLink() || !created.isDirectory()) {
		throw new GameResolutionError("cache_corrupt", `${label} must be a real directory`);
	}
}

async function collectEntries(environmentRoot: string): Promise<GameCacheEntry[]> {
	const output: GameCacheEntry[] = [];
	async function visit(directory: string): Promise<void> {
		for (const item of await readdir(directory, { withFileTypes: true })) {
			const absolute = path.join(directory, item.name);
			// Dirent 结果之后仍用 lstat 复核，防止 symlink 在枚举与读取之间伪装成文件。
			const info = await lstat(absolute);
			if (info.isSymbolicLink()) {
				throw new GameResolutionError("cache_corrupt", "Game environment must not contain symlinks");
			}
			if (info.isDirectory()) {
				await visit(absolute);
				continue;
			}
			if (!info.isFile()) {
				throw new GameResolutionError("cache_corrupt", "Game environment must contain regular files only");
			}
			const relative = path.relative(environmentRoot, absolute).split(path.sep).join("/");
			if (!safeRelativePosix(relative)) {
				throw new GameResolutionError("cache_corrupt", "Game environment contains an unsafe path");
			}
			const bytes = await readFile(absolute);
			output.push({ path: relative, size: bytes.length, sha256: sha256(bytes) });
		}
	}
	await visit(environmentRoot);
	output.sort((left, right) => compareCodePoints(left.path, right.path));
	return output;
}

function assertRequiredFiles(entries: readonly GameCacheEntry[]): void {
	if (!entries.some((entry) => entry.path === "metadata.json")) {
		throw new GameResolutionError("cache_corrupt", "Game environment must contain metadata.json");
	}
	if (!entries.some((entry) => entry.path.endsWith(".py"))) {
		throw new GameResolutionError("cache_corrupt", "Game environment must contain a Python Environment file");
	}
}

function parseManifest(value: unknown): GameCacheManifest {
	if (
		!isRecord(value) ||
		!keysAre(value, [
			"schema",
			"sourceLocator",
			"gameId",
			"sdkVersion",
			"runtimeVersion",
			"seed",
			"treeDigest",
			"entries",
		]) ||
		value.schema !== "pi-arc.game-cache.v1" ||
		typeof value.sourceLocator !== "string" ||
		typeof value.gameId !== "string" ||
		value.sdkVersion !== ARC_AGI_SDK_VERSION ||
		value.runtimeVersion !== PYTHON_RUNTIME_VERSION ||
		value.seed !== GAME_SEED ||
		typeof value.treeDigest !== "string" ||
		!SHA256.test(value.treeDigest) ||
		!Array.isArray(value.entries)
	) {
		throw new GameResolutionError("cache_corrupt", "Game cache manifest shape is invalid");
	}
	const entries: GameCacheEntry[] = value.entries.map((candidate) => {
		if (
			!isRecord(candidate) ||
			!keysAre(candidate, ["path", "size", "sha256"]) ||
			typeof candidate.path !== "string" ||
			!safeRelativePosix(candidate.path) ||
			!Number.isSafeInteger(candidate.size) ||
			(candidate.size as number) < 0 ||
			typeof candidate.sha256 !== "string" ||
			!SHA256.test(candidate.sha256)
		) {
			throw new GameResolutionError("cache_corrupt", "Game cache manifest entry is invalid");
		}
		return { path: candidate.path, size: candidate.size as number, sha256: candidate.sha256 };
	});
	for (let index = 0; index < entries.length; index += 1) {
		const current = entries[index];
		const previous = entries[index - 1];
		if (current === undefined || (previous !== undefined && compareCodePoints(previous.path, current.path) >= 0)) {
			throw new GameResolutionError("cache_corrupt", "Game cache manifest entries must be uniquely sorted");
		}
	}
	return {
		schema: "pi-arc.game-cache.v1",
		sourceLocator: value.sourceLocator,
		gameId: value.gameId,
		sdkVersion: ARC_AGI_SDK_VERSION,
		runtimeVersion: PYTHON_RUNTIME_VERSION,
		seed: GAME_SEED,
		treeDigest: value.treeDigest,
		entries,
	};
}

async function validatePublished(
	contentRoot: string,
	gameId: string,
	locator: string,
	expectedDigest: string,
): Promise<ResolvedGame> {
	await assertDirectory(contentRoot, "Game content root", false);
	const environmentRoot = path.join(contentRoot, "environment");
	await assertDirectory(environmentRoot, "Game environment root", false);
	let manifestText: string;
	let manifest: GameCacheManifest;
	try {
		manifestText = await readFile(path.join(contentRoot, "manifest.json"), "utf8");
		manifest = parseManifest(JSON.parse(manifestText) as unknown);
	} catch (error) {
		if (error instanceof GameResolutionError) throw error;
		throw new GameResolutionError("cache_corrupt", "Game cache manifest is not valid JSON");
	}
	if (canonicalJson(manifest) !== manifestText) {
		throw new GameResolutionError("cache_corrupt", "Game cache manifest is not canonical JSON");
	}
	if (
		manifest.gameId !== gameId ||
		manifest.sourceLocator !== locator ||
		manifest.treeDigest !== expectedDigest ||
		digestEntries(manifest.entries) !== expectedDigest
	) {
		throw new GameResolutionError("cache_corrupt", "Game cache manifest binding or tree digest is invalid");
	}
	assertRequiredFiles(manifest.entries);
	const actualEntries = await collectEntries(environmentRoot);
	if (canonicalJson(actualEntries) !== canonicalJson(manifest.entries)) {
		throw new GameResolutionError("cache_corrupt", "Game cache files differ from the manifest");
	}
	return {
		gameId,
		sourceLocator: locator,
		treeDigest: expectedDigest,
		contentRoot,
		environmentRoot,
		manifest,
		cacheHit: true,
	};
}

/** 只从受控 cache 或注入 catalog 解析完整 versioned Game ID。 */
export class GameResolver {
	private readonly catalog: GameCatalogPort;

	constructor(catalog: GameCatalogPort) {
		this.catalog = catalog;
	}

	/** 重新验证 cache hit，或经 staging 校验后原子发布一个 cache miss。 */
	async resolve(request: ResolveGameRequest): Promise<ResolvedGame> {
		if (!FULL_GAME_ID.test(request.gameId)) {
			throw new GameResolutionError("invalid_game_id", "Game ID must be a full versioned ID");
		}
		const cacheRoot = path.resolve(request.cacheRoot);
		await assertDirectory(cacheRoot, "Game cache root", true);
		const gameRoot = path.join(cacheRoot, request.gameId);
		await assertDirectory(gameRoot, "Game directory", true);
		const locator = sourceLocator(request.gameId);
		const published: string[] = [];
		for (const entry of await readdir(gameRoot, { withFileTypes: true })) {
			if (entry.name.startsWith(".staging-")) {
				if (!entry.isDirectory() || entry.isSymbolicLink()) {
					throw new GameResolutionError("cache_corrupt", "Game staging entry is not a real directory");
				}
				continue;
			}
			if (!SHA256.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
				throw new GameResolutionError("cache_corrupt", "Game directory contains an invalid published entry");
			}
			published.push(entry.name);
		}
		if (published.length > 1) {
			throw new GameResolutionError("cache_conflict", "Game locator has multiple published tree digests");
		}
		const existingDigest = published[0];
		if (existingDigest !== undefined) {
			return validatePublished(path.join(gameRoot, existingDigest), request.gameId, locator, existingDigest);
		}
		if (request.offline) {
			throw new GameResolutionError("game_cache_miss", "Game is absent from the verified offline cache");
		}

		const stagingRoot = path.join(gameRoot, `.staging-${randomUUID()}`);
		const stagingEnvironment = path.join(stagingRoot, "environment");
		await mkdir(stagingEnvironment, { recursive: true });
		try {
			let receipt: GameCatalogReceipt;
			try {
				receipt = await this.catalog.fetch(request.gameId, locator, stagingEnvironment);
			} catch (error) {
				throw new GameResolutionError(
					"catalog_failed",
					`Game catalog fetch failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			if (receipt.gameId !== request.gameId || receipt.sourceLocator !== locator) {
				throw new GameResolutionError("catalog_mismatch", "Catalog returned a different Game identity");
			}
			const entries = await collectEntries(stagingEnvironment);
			assertRequiredFiles(entries);
			const treeDigest = digestEntries(entries);
			const manifest: GameCacheManifest = {
				schema: "pi-arc.game-cache.v1",
				sourceLocator: locator,
				gameId: request.gameId,
				sdkVersion: ARC_AGI_SDK_VERSION,
				runtimeVersion: PYTHON_RUNTIME_VERSION,
				seed: GAME_SEED,
				treeDigest,
				entries,
			};
			await writeFile(path.join(stagingRoot, "manifest.json"), canonicalJson(manifest), "utf8");
			const target = path.join(gameRoot, treeDigest);
			try {
				await lstat(target);
				const concurrent = await validatePublished(target, request.gameId, locator, treeDigest);
				return { ...concurrent, cacheHit: true };
			} catch (error) {
				if (!isMissing(error)) throw error;
			}
			await rename(stagingRoot, target);
			const publishedGame = await validatePublished(target, request.gameId, locator, treeDigest);
			return { ...publishedGame, cacheHit: false };
		} finally {
			// 成功 rename 后原路径已不存在；失败时递归清除未发布 staging。
			await rm(stagingRoot, { recursive: true, force: true });
		}
	}
}
