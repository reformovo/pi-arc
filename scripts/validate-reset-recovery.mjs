#!/usr/bin/env node
/**
 * Targeted driver-replay diagnostic, NOT a model benchmark or a new SDK tool API.
 * Build first. Offline mode verifies the source; --live requires explicit consent.
 * Setup uses the controller's native driver boundary, never fabricated model output.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_SETUP_ACTIONS = 179;
export const DEFAULT_POST_RESET_BUDGET = 12;
const NATIVE_GRID = 64;

/** @param {unknown} value @param {string} label @returns {Record<string, unknown>} */
function object(value, label) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: invalid object`);
	return /** @type {Record<string, unknown>} */ (value);
}

/** Reads recorded intents, which are NOT proof of completed actions. This builds a candidate plan only. */
/** @param {string} domainPath */
export async function readRecordedIntents(domainPath, count = DEFAULT_SETUP_ACTIONS) {
	const actions = [];
	const lines = (await readFile(domainPath, "utf8")).split("\n");
	for (const line of lines) {
		if (!line.trim()) continue;
		const record = object(JSON.parse(line), "domain record");
		if (record.recordType !== "action.intent") continue;
		const payload = object(record.payload, "action payload");
		const action = object(payload.action, "action");
		if (typeof action.name !== "string" || !/^ACTION[1-7]$/.test(action.name))
			throw new Error("invalid recorded action");
		actions.push({ name: action.name, data: action.data && object(action.data, "action data") });
		if (actions.length === count) break;
	}
	if (actions.length !== count) throw new Error(`expected ${count} action.intent records`);
	return actions;
}

/** Convert the archived 64x64 ACTION6 coordinates to the runtime's 1024x1024 centers. */
/** @param {{name: string, data?: unknown}} action */
export function toVisualAction(action) {
	if (action.name !== "ACTION6") return { action: action.name };
	const data = object(action.data, "ACTION6 data");
	const x = data.x;
	const y = data.y;
	if (typeof x !== "number" || typeof y !== "number") throw new Error("invalid coordinates");
	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= NATIVE_GRID || y < 0 || y >= NATIVE_GRID)
		throw new Error("recorded ACTION6 coordinate is not native 64x64");
	return {
		action: action.name,
		x: Math.floor((x + 0.5) * (1024 / NATIVE_GRID)),
		y: Math.floor((y + 0.5) * (1024 / NATIVE_GRID)),
	};
}

/** @param {{name: string, data?: unknown}[]} actions */
export function buildReplayPlan(actions) {
	return [
		...actions.map(toVisualAction),
		{
			action: "RESET",
			retry_state:
				"Recovery validation: continue from the new attempt using the current 1024x1024 coordinate contract. No solution is supplied; inspect the fresh observation and available actions.",
		},
	];
}

/** Offline source verification or explicitly consented diagnostic execution. */
/** @param {{domainPath: string, artifactRoot?: string | undefined, gameCache?: string | undefined, live?: boolean, setupCount?: number, maxRequests?: number, maxOutputTokens?: number, callTimeoutMs?: number}} settings */
export async function runValidation(settings) {
	const { runDiagnostic, readVerifiedSource, validateSetupCount } = await import(
		"./lib/reset-recovery-diagnostic.mjs"
	);
	const setupCount = validateSetupCount(settings.setupCount ?? DEFAULT_SETUP_ACTIONS);
	if (settings.live) return runDiagnostic({ ...settings, setupCount });
	const source = await readVerifiedSource(settings.domainPath, setupCount);
	return {
		mode: "offline",
		setupActions: source.actions.length,
		plannedActions: source.actions.length + 1,
		coordinateSpace: "native-64-to-visual-1024-centers",
		liveValidationImplemented: true,
		completedActionsVerified: true,
		sourceDigest: source.digest,
		game: source.game,
	};
}

/** @param {string[]} argv */
async function main(argv) {
	const live = argv.includes("--live");
	if (live && !argv.includes("--confirm-real-model")) throw new Error("live mode requires --confirm-real-model");
	/** @param {string} name @param {string | undefined} fallback */
	const get = (name, fallback) => argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
	const domainPath = get("--domain", process.env.PI_ARC_FT09_DOMAIN);
	if (!domainPath) throw new Error("--domain=... is required");
	const report = await runValidation({
		domainPath,
		artifactRoot: get("--artifacts-root", path.resolve("run-artifacts/ft09-reset-recovery")),
		gameCache: get("--game-cache", path.resolve("game-cache")),
		setupCount: Number(get("--setup-count", String(DEFAULT_SETUP_ACTIONS))),
		maxRequests: Number(get("--max-requests", "8")),
		maxOutputTokens: Number(get("--max-output-tokens", "1024")),
		callTimeoutMs: Number(get("--call-timeout-ms", "120000")),
		live,
	});
	const output = JSON.stringify(report, null, 2);
	console.log(output);
	const out = argv.find((arg) => arg.startsWith("--report="));
	if (out) {
		await mkdir(path.dirname(out.slice(9)), { recursive: true });
		await writeFile(out.slice(9), `${output}\n`, { flag: "wx", mode: 0o600 });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
	main(process.argv.slice(2)).catch(() => {
		console.error(JSON.stringify({ errorCode: "reset-recovery-validation-failed" }));
		process.exitCode = 1;
	});
