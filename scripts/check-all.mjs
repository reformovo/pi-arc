import { reportFailure, runCommand } from "./lib/run-command.mjs";

const scripts = [
	"check:dependencies",
	"check:format-lint",
	"check:types",
	"test:ts",
	"test:py",
	"test:contract",
	"test:integration",
	"check:spec",
];

async function main() {
	for (const script of scripts) await runCommand("npm", ["run", script]);
}

main().catch(reportFailure);
