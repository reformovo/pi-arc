import { reportFailure, runCommand } from "./lib/run-command.mjs";

async function main() {
	await runCommand("node_modules/.bin/biome", ["check", "--error-on-warnings", "."]);
	await runCommand("uv", ["run", "--locked", "ruff", "format", "--check", "."]);
	await runCommand("uv", ["run", "--locked", "ruff", "check", "--no-fix", "."]);
	await runCommand(process.execPath, ["scripts/check-suppressions.mjs"]);
}

main().catch(reportFailure);
