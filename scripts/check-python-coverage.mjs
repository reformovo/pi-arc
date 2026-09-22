import { readFile } from "node:fs/promises";
import { reportFailure } from "./lib/run-command.mjs";

/** @param {number} covered @param {number} total */
function percent(covered, total) {
	return total === 0 ? 100 : (covered / total) * 100;
}

async function main() {
	const report = JSON.parse(await readFile("coverage/python/coverage.json", "utf8"));
	const totals = report.totals;
	const lines = percent(totals.covered_lines, totals.num_statements);
	const branches = percent(totals.covered_branches, totals.num_branches);
	if (lines < 90 || branches < 85) {
		throw new Error(`Python coverage below threshold: lines=${lines.toFixed(2)} branches=${branches.toFixed(2)}`);
	}
	process.stdout.write(`Python coverage: lines=${lines.toFixed(2)}% branches=${branches.toFixed(2)}%\n`);
}

main().catch(reportFailure);
