#!/usr/bin/env node
/**
 * Build a fresh, driver-generated FT09 setup proof for offline RESET diagnostics.
 * This script never calls a model, fetches a game, reads solution material, or reuses
 * the source run's Environment instance. The only setup action is native ACTION6(0, 0).
 */
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ArtifactStore } from "../dist/adapters/artifact-store.js";
import { GAME_SEED, GameResolver } from "../dist/adapters/game-resolver.js";
import { canonicalJsonDigest } from "../dist/adapters/sha256.js";
import { SidecarClient } from "../dist/adapters/sidecar-client.js";
import { VisualPngPublisher } from "../dist/adapters/visual-png.js";
import { RunController } from "../dist/application/run-controller.js";
import { readVerifiedSource } from "./lib/reset-recovery-diagnostic.mjs";

export const MAX_ACTIONS = 256;
// A visible level-one tile from the cached FT09 initial observation; this is
// a fixed driver probe, not a model-derived solution.
export const SETUP_CLICK = Object.freeze({ x: 39, y: 39 });

/** Enforce level-one state after every step; visual meter changes are not level progress.
 * @param {Pick<import('../src/application/run-controller.js').RunController, 'turn' | 'play'>} controller
 */
export async function driveLevelOneSetup(controller) {
	let count = 0;
	const assertLevelOne = () => {
		if (controller.turn.observation.levelsCompleted !== 0 || controller.turn.level !== 1)
			throw new Error("setup_level_progressed");
		if (!["NOT_FINISHED", "GAME_OVER"].includes(controller.turn.observation.state))
			throw new Error("setup_state_invalid");
	};
	assertLevelOne();
	const isGameOver = () => /** @type {string} */ (controller.turn.observation.state) === "GAME_OVER";
	if (isGameOver()) throw new Error("setup_initial_game_over");
	while (!isGameOver()) {
		if (count >= MAX_ACTIONS) throw new Error("setup_action_limit_exceeded");
		if (!controller.turn.observation.availableActions.includes("ACTION6"))
			throw new Error("setup_action_unavailable");
		await controller.play({
			actionId: `setup-click-${count + 1}`,
			invocationId: `setup-click-${count + 1}`,
			action: { name: "ACTION6", data: { ...SETUP_CLICK } },
		});
		count++;
		assertLevelOne();
	}
	return count;
}

/** @param {string} domainPath @param {string} gameCache */
async function readSourceBinding(domainPath, gameCache) {
	if (path.basename(domainPath) !== "domain.jsonl") throw new Error("source_domain_invalid");
	const sourceRoot = path.dirname(path.resolve(domainPath));
	const manifest = JSON.parse(await readFile(path.join(sourceRoot, "manifest.json"), "utf8"));
	if (manifest.seed !== GAME_SEED || !manifest.game || typeof manifest.game.id !== "string")
		throw new Error("source_manifest_invalid");
	if (!manifest.game.id.startsWith("ft09-")) throw new Error("source_game_invalid");
	const game = await new GameResolver({ fetch: () => Promise.reject(new Error("offline_only")) }).resolve({
		gameId: manifest.game.id,
		cacheRoot: gameCache,
		offline: true,
	});
	if (game.sourceLocator !== manifest.game.sourceLocator || game.treeDigest !== manifest.game.treeDigest)
		throw new Error("source_cache_binding_mismatch");
	const records = await new ArtifactStore(sourceRoot).readDomain();
	return {
		game: { id: game.gameId, sourceLocator: game.sourceLocator, treeDigest: game.treeDigest },
		environmentRoot: game.environmentRoot,
		digest: canonicalJsonDigest([...records]),
	};
}

/** @param {{domainPath: string, gameCache?: string | undefined, artifactRoot?: string | undefined}} settings */
export async function prepareLevelOneResetSource(settings) {
	const gameCache = path.resolve(settings.gameCache ?? "game-cache");
	const outputRoot = path.resolve(settings.artifactRoot ?? "run-artifacts/ft09-level-one-reset-source");
	const source = await readSourceBinding(settings.domainPath, gameCache);
	await mkdir(outputRoot, { recursive: true });
	if ((await readdir(outputRoot)).length) throw new Error("source_output_not_empty");
	const receipts = await mkdtemp(path.join(os.tmpdir(), "pi-arc-source-receipts-"));
	const environment = new SidecarClient({
		environmentRoot: source.environmentRoot,
		cacheRoot: receipts,
		gameId: source.game.id,
		sourceLocator: source.game.sourceLocator,
		treeDigest: source.game.treeDigest,
		seed: GAME_SEED,
		python: fileURLToPath(new URL("../.venv/bin/python", import.meta.url)),
		pythonPath: fileURLToPath(new URL("../python", import.meta.url)),
	});
	let controller;
	let count = 0;
	try {
		controller = await RunController.start(
			{
				manifest: {
					schema: "pi-arc.run-manifest.v1",
					runId: randomUUID(),
					game: source.game,
					model: { provider: "diagnostic-driver", modelId: "recorded-setup", validationMode: "setup_only" },
					runtime: { piAgentCore: "0.86.0", piAi: "0.86.0" },
					coordinates: 1024,
					seed: GAME_SEED,
					config: { actionBudget: MAX_ACTIONS + 1, setupActionLimit: MAX_ACTIONS, gameOffline: true },
				},
				sessionId: "setup-only-driver",
				laneId: "arc",
			},
			{
				artifacts: new ArtifactStore(outputRoot),
				environment,
				visuals: new VisualPngPublisher(outputRoot),
				now: () => new Date().toISOString(),
				digest: canonicalJsonDigest,
				actionBudget: MAX_ACTIONS + 1,
			},
		);
		count = await driveLevelOneSetup(controller);
		await controller.finish("model_no_progress");
	} catch (error) {
		if (controller && !controller.termination) await controller.finish("controller_failure");
		throw error;
	} finally {
		try {
			await environment.close();
		} finally {
			await rm(receipts, { recursive: true, force: true });
		}
	}
	if (!controller || controller.turn.observation.state !== "GAME_OVER") throw new Error("setup_proof_invalid");
	const verified = await readVerifiedSource(path.join(outputRoot, "domain.jsonl"), count);
	const audit = await new ArtifactStore(outputRoot).audit();
	if (
		!audit.ok ||
		verified.actions.some((step) => {
			const observation = step.observation;
			return (
				!observation ||
				typeof observation !== "object" ||
				Array.isArray(observation) ||
				observation.levelsCompleted !== 0
			);
		})
	)
		throw new Error("setup_proof_invalid");
	const report = {
		purpose: "level_one_reset_source_setup",
		validationMode: "setup_only",
		source: { root: path.dirname(path.resolve(settings.domainPath)), digest: source.digest, game: source.game },
		setupCount: count,
		root: outputRoot,
		digest: verified.digest,
		audit,
		maxActions: MAX_ACTIONS,
		terminationReason: controller.termination?.terminationReason ?? null,
		reachedGameOver: true,
		noLevelProgress: true,
	};
	await writeFile(path.join(outputRoot, "setup-source-summary.json"), `${JSON.stringify(report, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	return report;
}

/** @param {string[]} argv */
async function main(argv) {
	/** @param {string} name @param {string | undefined} fallback */
	const get = (name, fallback) => argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
	const domainPath = get("--domain", process.env.PI_ARC_FT09_DOMAIN);
	if (!domainPath) throw new Error("--domain=... is required");
	const report = await prepareLevelOneResetSource({
		domainPath,
		gameCache: get("--game-cache", path.resolve("game-cache")),
		artifactRoot: get("--artifacts-root", path.resolve("run-artifacts/ft09-level-one-reset-source")),
	});
	console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
	main(process.argv.slice(2)).catch(() => {
		console.error(JSON.stringify({ errorCode: "level-one-reset-source-failed" }));
		process.exitCode = 1;
	});
