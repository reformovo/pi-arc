import { reportFailure, runCommand } from "./lib/run-command.mjs";

async function main() {
	await runCommand("node_modules/.bin/vitest", ["run", "--config", "vitest.contract.config.ts"]);
	await runCommand("uv", ["run", "--locked", "pytest", "tests/python/contract", "-m", "contract"]);
}

main().catch(reportFailure);
