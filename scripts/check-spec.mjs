import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { reportFailure, runCommand } from "./lib/run-command.mjs";

/** @param {string} root @returns {Promise<string[]>} */
async function collectMarkdown(root) {
	/** @type {string[]} */
	const files = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if ([".git", ".delta", "node_modules", ".venv"].includes(entry.name)) continue;
		const candidate = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...(await collectMarkdown(candidate)));
		else if (entry.isFile() && entry.name.endsWith(".md")) files.push(candidate);
	}
	return files;
}

/** @param {string} file */
async function fileExists(file) {
	try {
		return (await stat(file)).isFile() || (await stat(file)).isDirectory();
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

async function main() {
	/** @type {string[]} */
	const errors = [];
	const files = await collectMarkdown(".");
	for (const file of files) {
		const lines = (await readFile(file, "utf8")).split("\n");
		let tableColumns;
		for (const [index, line] of lines.entries()) {
			if (/[\t ]+$/.test(line)) errors.push(`${file}:${index + 1}: trailing whitespace`);
			for (const match of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
				const raw = match[1];
				if (raw === undefined) continue;
				const target = raw.replace(/^</, "").replace(/>$/, "").split("#", 1)[0];
				if (target === undefined || target.length === 0 || /^(?:https?:|mailto:|codex:)/.test(target)) continue;
				const resolved = path.resolve(path.dirname(file), target);
				if (!(await fileExists(resolved))) errors.push(`${file}:${index + 1}: missing link target ${target}`);
			}
			if (line.startsWith("|") && line.endsWith("|")) {
				const columns = (line.match(/(?<!\\)\|/g) ?? []).length - 1;
				if (tableColumns !== undefined && columns !== tableColumns) {
					errors.push(`${file}:${index + 1}: table has ${columns} columns, expected ${tableColumns}`);
				}
				tableColumns = columns;
			} else tableColumns = undefined;
		}
	}

	const traceability = await readFile("docs/design/requirements-traceability.md", "utf8");
	const rows = [...traceability.matchAll(/^\| (R-\d{3}) /gm)].map((match) => match[1]);
	const expected = Array.from({ length: 60 }, (_, index) => `R-${String(index + 1).padStart(3, "0")}`);
	if (JSON.stringify(rows) !== JSON.stringify(expected))
		errors.push("requirements traceability must contain ordered R-001..R-060");

	const specBytes = await readFile("docs/pi-arc.md");
	const specDigest = createHash("sha256").update(specBytes).digest("hex");
	const handoff = await readFile("docs/implementation-handoff.md", "utf8");
	const recorded = handoff.match(/^spec-sha256: ([0-9a-f]{64})$/m)?.[1];
	if (recorded !== specDigest) errors.push(`handoff spec hash ${String(recorded)} differs from ${specDigest}`);
	if (errors.length > 0) throw new Error(errors.join("\n"));

	await runCommand(process.execPath, ["scripts/check-generated.mjs"]);
	await runCommand(process.execPath, ["scripts/check-ci.mjs"]);
	await runCommand("git", ["diff", "--check"]);
	process.stdout.write(`specification: OK (${files.length} Markdown files)\n`);
}

main().catch(reportFailure);
