import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { reportFailure } from "./lib/run-command.mjs";

const roots = ["src", "tests", "scripts"];
const checkedExtensions = new Set([".cts", ".js", ".mjs", ".mts", ".py", ".ts"]);
const scannerPath = path.normalize("scripts/check-suppressions.mjs");

/** @param {string} root @returns {Promise<string[]>} */
async function collectFiles(root) {
	/** @type {string[]} */
	const files = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const candidate = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...(await collectFiles(candidate)));
		else if (entry.isFile() && checkedExtensions.has(path.extname(entry.name))) files.push(candidate);
	}
	return files;
}

/** @param {string} line @returns {string[]} */
function lineIssues(line) {
	/** @type {string[]} */
	const issues = [];
	if (line.includes("@ts-nocheck")) issues.push("@ts-nocheck is forbidden");
	if (line.includes("@ts-ignore")) issues.push("@ts-ignore is forbidden; use a narrow, explained @ts-expect-error");
	if (line.includes("@ts-expect-error") && !/@ts-expect-error(?::| --)\s+\S.{2,}/.test(line)) {
		issues.push("@ts-expect-error requires a reason");
	}
	if (line.includes("biome-ignore") && !/biome-ignore\s+\S+\/\S+:\s+\S.{2,}/.test(line)) {
		issues.push("biome-ignore requires a precise rule and reason");
	}
	if (/pyright:\s*(?:ignore|report\S+\s*=\s*false)/.test(line) && !/pyright:\s*ignore\[[^\]]+\].*--\s+\S/.test(line)) {
		issues.push("Pyright suppression requires a rule code and reason; module-wide disables are forbidden");
	}
	if (/type:\s*ignore/.test(line) && !/type:\s*ignore\[[^\]]+\].*--\s+\S/.test(line)) {
		issues.push("type: ignore requires a rule code and reason");
	}
	if (/\bnoqa\b/.test(line) && !/noqa:\s*[A-Z]+\d+(?:,\s*[A-Z]+\d+)*\s+--\s+\S/.test(line)) {
		issues.push("noqa requires exact rule codes and a reason");
	}
	if (/pragma:\s*no cover/.test(line) && !/pragma:\s*no cover\s+--\s+\S/.test(line)) {
		issues.push("pragma: no cover requires a reason");
	}
	if (/(?:v8|c8|istanbul)\s+ignore\b/.test(line) && !/(?:v8|c8|istanbul)\s+ignore\b.*--\s+\S/.test(line)) {
		issues.push("JavaScript coverage suppression requires a reason");
	}
	return issues;
}

function selfTest() {
	const rejected = [
		"// @ts-nocheck",
		"// @ts-ignore",
		"// @ts-expect-error",
		"// biome-ignore lint/suspicious/noExplicitAny",
		"value = call()  # type: ignore",
		"# pyright: reportUnknownVariableType=false",
		"import thing  # noqa",
		"if defensive:  # pragma: no cover",
		"/* v8 ignore next */",
	];
	const accepted = [
		"// @ts-expect-error: upstream declaration intentionally omits this overload",
		"// biome-ignore lint/suspicious/noExplicitAny: boundary is validated at runtime",
		"value = call()  # type: ignore[no-untyped-call] -- upstream has no types",
		"value = call()  # pyright: ignore[reportUnknownMemberType] -- narrow adapter boundary",
		"import thing  # noqa: F401 -- imported for registration",
		"if defensive:  # pragma: no cover -- platform-only guard",
		"/* v8 ignore next -- platform-only guard */",
	];
	if (rejected.some((line) => lineIssues(line).length === 0))
		throw new Error("suppression checker rejected-case self-test failed");
	if (accepted.some((line) => lineIssues(line).length !== 0))
		throw new Error("suppression checker accepted-case self-test failed");
}

async function main() {
	selfTest();
	/** @type {string[]} */
	const violations = [];
	for (const root of roots) {
		for (const file of await collectFiles(root)) {
			if (path.normalize(file) === scannerPath) continue;
			const lines = (await readFile(file, "utf8")).split("\n");
			lines.forEach((line, index) => {
				for (const issue of lineIssues(line)) violations.push(`${file}:${index + 1}: ${issue}`);
			});
		}
	}
	if (violations.length > 0) throw new Error(violations.join("\n"));
	process.stdout.write("suppression policy: OK\n");
}

main().catch(reportFailure);
