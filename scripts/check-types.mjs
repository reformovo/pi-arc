import { reportFailure, runCommand } from "./lib/run-command.mjs";

async function main() {
	await runCommand("node_modules/.bin/tsc", ["--noEmit"]);
	await runCommand("node_modules/.bin/pyright", []);
	await runCommand(process.execPath, ["scripts/check-boundaries.mjs"]);
	await runCommand("uv", ["run", "--locked", "python", "scripts/python/check_boundaries.py"]);
}

main().catch(reportFailure);
