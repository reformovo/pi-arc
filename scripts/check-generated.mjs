import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { reportFailure } from "./lib/run-command.mjs";

/** @param {string} root @returns {Promise<string[]>} */
async function collect(root) {
	try {
		if (!(await stat(root)).isDirectory()) return [];
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
	/** @type {string[]} */
	const files = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const candidate = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...(await collect(candidate)));
		else if (entry.isFile()) files.push(candidate);
	}
	return files;
}

async function main() {
	const manifest = JSON.parse(await readFile("generated-manifest.json", "utf8"));
	const entries = manifest.files;
	if (!Array.isArray(entries)) throw new Error("generated-manifest.json files must be an array");
	const actual = (await collect("generated")).map((file) => file.split(path.sep).join("/")).sort();
	const expected = entries.map((entry) => entry.path).sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected))
		throw new Error("generated file list differs from generated-manifest.json");
	/** @type {{ sourceVersion: number; schemas: Array<{ $id: string; [key: string]: unknown }> }} */
	const source = JSON.parse(await readFile("schemas/source.json", "utf8"));
	if (source.sourceVersion !== 1 || !Array.isArray(source.schemas)) throw new Error("invalid schema source");
	const generatedByName = new Map(
		source.schemas.map((schema) => [
			`generated/schemas/${schema.$id.replaceAll(".", "-")}.schema.json`,
			`${JSON.stringify(schema, null, "\t")}\n`,
		]),
	);
	if (
		generatedByName.size !== source.schemas.length ||
		[...generatedByName.values()].some((value) => typeof value !== "string")
	) {
		throw new Error("schema source contains duplicate or invalid generated entries");
	}
	for (const [file, expectedText] of generatedByName) {
		if ((await readFile(file, "utf8")) !== expectedText) throw new Error(`${file} differs from schemas/source.json`);
	}
	for (const entry of entries) {
		if (typeof entry.path !== "string" || typeof entry.sha256 !== "string")
			throw new Error("invalid generated manifest entry");
		const digest = createHash("sha256")
			.update(await readFile(entry.path))
			.digest("hex");
		if (digest !== entry.sha256) throw new Error(`${entry.path} differs from its generated digest`);
	}
	process.stdout.write(`generated drift: OK (${entries.length} files)\n`);
}

main().catch(reportFailure);
