import { mkdir } from "node:fs/promises";
import { reportFailure, runCommand } from "./lib/run-command.mjs";

async function main() {
	await mkdir("coverage/python", { recursive: true });
	await runCommand("uv", [
		"run",
		"--locked",
		"pytest",
		"tests/python/unit",
		"--cov=python/pi_arc_sidecar",
		"--cov-branch",
		"--cov-report=term-missing",
		"--cov-report=json:coverage/python/coverage.json",
	]);
	await runCommand(process.execPath, ["scripts/check-python-coverage.mjs"]);
}

main().catch(reportFailure);
