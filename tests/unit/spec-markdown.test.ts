import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectMarkdown } from "../../scripts/lib/spec-markdown.mjs";

const temporaryRoots: string[] = [];
const outputDirectories = [
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
];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createTree(files: Record<string, string>): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "pi-arc-spec-"));
	temporaryRoots.push(root);
	for (const [relative, contents] of Object.entries(files)) {
		const file = path.join(root, relative);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, contents);
	}
	return root;
}

// Mirror check-spec's whitespace predicate over only the selected Markdown.
async function whitespaceFailures(root: string): Promise<string[]> {
	const failures: string[] = [];
	for (const file of await collectMarkdown(root)) {
		if ((await readFile(file, "utf8")).split("\n").some((line) => /[\t ]+$/.test(line))) {
			failures.push(path.relative(root, file));
		}
	}
	return failures.sort();
}

describe("specification Markdown scope", () => {
	it("ignores malformed runtime/cache/build/temp output without changing it", async () => {
		const malformed = "# Generated GUIDE  \n[missing](does-not-exist.md)\n";
		const files = Object.fromEntries(
			outputDirectories.map((directory) => [`${directory}/nested/GUIDE.md`, malformed]),
		);
		const root = await createTree({ ...files, "README.md": "# Maintained\n" });

		expect(await collectMarkdown(root)).toEqual([path.join(root, "README.md")]);
		expect(await whitespaceFailures(root)).toEqual([]);
		for (const relative of Object.keys(files)) {
			expect(await readFile(path.join(root, relative), "utf8")).toBe(malformed);
		}
	});

	it("keeps maintained Markdown, generated specifications, and nested output names in scope", async () => {
		const malformed = "# Maintained but invalid  \n";
		const files = Object.fromEntries(outputDirectories.map((directory) => [`docs/${directory}/GUIDE.md`, malformed]));
		const root = await createTree({
			...files,
			"README.md": malformed,
			"docs/new-untracked.md": malformed,
			"generated/specification.md": malformed,
			"tests/fixtures/run-artifacts/GUIDE.md": malformed,
			"docs/not-markdown.txt": malformed,
		});
		const expected = [
			...Object.keys(files),
			"README.md",
			"docs/new-untracked.md",
			"generated/specification.md",
			"tests/fixtures/run-artifacts/GUIDE.md",
		].sort();

		expect((await collectMarkdown(root)).map((file) => path.relative(root, file)).sort()).toEqual(expected);
		expect(await whitespaceFailures(root)).toEqual(expected);
	});

	it("always skips repository and dependency internals", async () => {
		const files: Record<string, string> = { "docs/guide.md": "# Guide\n" };
		for (const directory of [".git", ".delta", "node_modules", ".venv"]) {
			files[`${directory}/GUIDE.md`] = "bad  \n";
			files[`docs/${directory}/GUIDE.md`] = "bad  \n";
		}
		const root = await createTree(files);

		expect(await collectMarkdown(root)).toEqual([path.join(root, "docs/guide.md")]);
	});
});
