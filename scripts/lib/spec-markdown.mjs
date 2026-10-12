import { readdir } from "node:fs/promises";
import path from "node:path";

// Repository/dependency internals are never project-maintained documentation.
const excludedDirectoryNames = new Set([".git", ".delta", "node_modules", ".venv"]);

// Root output locations documented in .gitignore. Do not exclude these basenames
// recursively: docs/build, tests/fixtures/run-artifacts, etc. remain in scope.
// This is deliberately not a generic gitignore filter: maintained untracked
// Markdown and generated specification documents must still be validated.
const excludedRootDirectories = new Set([
	"dist",
	"build",
	"coverage",
	".pytest_cache",
	".ruff_cache",
	"__pycache__",
	".pi-arc",
	"game-cache",
	"run-artifacts",
	"tmp",
]);

/** @param {string} root @returns {Promise<string[]>} */
export function collectMarkdown(root) {
	/** @param {string} directory @param {boolean} isRoot @returns {Promise<string[]>} */
	async function visit(directory, isRoot) {
		/** @type {string[]} */
		const files = [];
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const candidate = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (excludedDirectoryNames.has(entry.name) || (isRoot && excludedRootDirectories.has(entry.name))) continue;
				files.push(...(await visit(candidate, false)));
			} else if (entry.isFile() && entry.name.endsWith(".md")) files.push(candidate);
		}
		return files;
	}
	return visit(root, true);
}
