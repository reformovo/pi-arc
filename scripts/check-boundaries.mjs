import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { reportFailure } from "./lib/run-command.mjs";

const layers = new Set(["domain", "application", "protocol", "adapters", "composition"]);
/** @type {Record<string, ReadonlySet<string>>} */
const allowedInternal = {
	domain: new Set(["domain"]),
	application: new Set(["domain", "application", "protocol"]),
	protocol: new Set(["protocol"]),
	adapters: new Set(["domain", "application", "protocol", "adapters"]),
	composition: new Set(["domain", "application", "protocol", "adapters", "composition"]),
};

/** @param {string} root @returns {Promise<string[]>} */
async function collectTypeScript(root) {
	/** @type {string[]} */
	const files = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const candidate = path.join(root, entry.name);
		if (entry.isDirectory()) files.push(...(await collectTypeScript(candidate)));
		else if (entry.isFile() && /\.[cm]?ts$/.test(entry.name)) files.push(candidate);
	}
	return files;
}

/** @param {string} file @param {string} sourceRoot */
function owner(file, sourceRoot) {
	const relative = path.relative(sourceRoot, file);
	const [layer, adapter] = relative.split(path.sep);
	return { layer: layers.has(layer ?? "") ? layer : undefined, adapter };
}

/** @param {string} importer @param {string} specifier */
function resolveRelative(importer, specifier) {
	const target = path.resolve(path.dirname(importer), specifier);
	return target.replace(/\.(?:js|mjs|cjs)$/, ".ts");
}

/** @param {string} candidate @param {string} root */
function isWithin(candidate, root) {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	return relative.length === 0 || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/** @param {string} sourceRoot @returns {Promise<string[]>} */
async function boundaryViolations(sourceRoot) {
	/** @type {string[]} */
	const violations = [];
	for (const file of await collectTypeScript(sourceRoot)) {
		const importer = owner(file, sourceRoot);
		if (importer.layer === undefined) {
			violations.push(`${file}: tracked source file has no logical owner`);
			continue;
		}
		const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
		for (const statement of source.statements) {
			if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
			const moduleSpecifier = statement.moduleSpecifier;
			if (moduleSpecifier === undefined || !ts.isStringLiteral(moduleSpecifier)) continue;
			const specifier = moduleSpecifier.text;
			if (!specifier.startsWith(".")) {
				if (importer.layer === "domain" || importer.layer === "application" || importer.layer === "protocol") {
					violations.push(`${file}: ${importer.layer} cannot import external module ${specifier}`);
				}
				continue;
			}
			const resolved = resolveRelative(file, specifier);
			if (!isWithin(resolved, sourceRoot)) {
				violations.push(`${file}: relative production import escapes ${sourceRoot}: ${specifier}`);
				continue;
			}
			const imported = owner(resolved, sourceRoot);
			if (imported.layer === undefined) continue;
			const allowed = allowedInternal[importer.layer];
			if (allowed === undefined || !allowed.has(imported.layer)) {
				violations.push(`${file}: ${importer.layer} cannot depend on ${imported.layer}`);
			}
			if (importer.layer === "adapters" && imported.layer === "adapters" && importer.adapter !== imported.adapter) {
				violations.push(
					`${file}: adapter ${String(importer.adapter)} cannot depend on adapter ${String(imported.adapter)}`,
				);
			}
		}
	}
	return violations;
}

async function main() {
	const fixtureRoot = "tests/architecture-fixtures/invalid/src";
	const expected = await boundaryViolations(fixtureRoot);
	if (expected.length === 0) throw new Error("architecture checker negative-fixture self-test failed");
	const violations = await boundaryViolations("src");
	if (violations.length > 0) throw new Error(violations.join("\n"));
	process.stdout.write(`import boundaries: OK (negative fixture produced ${expected.length} violation)\n`);
}

main().catch(reportFailure);
