import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { reportFailure, runCommand } from "./lib/run-command.mjs";

const expectedNode = "22.23.1";
const expectedNpm = "10.9.8";
const expectedRuntime = {
	"@earendil-works/pi-agent-core": "0.86.0",
	"@earendil-works/pi-ai": "0.86.0",
};
const expectedDev = {
	"@biomejs/biome": "2.3.5",
	"@types/node": "22.19.19",
	"@vitest/coverage-v8": "4.1.9",
	pyright: "1.1.413",
	typescript: "5.9.3",
	vite: "8.0.16",
	vitest: "4.1.9",
};
const approvedIgnoredInstallScripts = new Set([
	"node_modules/@google/genai",
	"node_modules/esbuild",
	"node_modules/fsevents",
	"node_modules/protobufjs",
]);

/** @param {unknown} condition @param {string} message */
function assert(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {Record<string, string>} actual @param {Record<string, string>} expected @param {string} label */
function assertPins(actual, expected, label) {
	assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} pins differ from the accepted specification`);
	for (const [name, version] of Object.entries(actual)) {
		assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version), `${name} is not an exact version: ${version}`);
	}
}

async function main() {
	assert(process.version === `v${expectedNode}`, `Node must be v${expectedNode}, got ${process.version}`);
	const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
	const uvVersion = execFileSync("uv", ["--version"], { encoding: "utf8" }).trim();
	assert(npmVersion === expectedNpm, `npm must be ${expectedNpm}, got ${npmVersion}`);
	assert(/^uv 0\.8\.12(?:\s|$)/.test(uvVersion), `uv must be 0.8.12, got ${uvVersion}`);
	const packageJson = JSON.parse(await readFile("package.json", "utf8"));
	assert(packageJson.packageManager === `npm@${expectedNpm}`, "packageManager must pin npm 10.9.8");
	assert(packageJson.engines?.node === expectedNode, "engines.node must be exact");
	assert(packageJson.engines?.npm === expectedNpm, "engines.npm must be exact");
	assertPins(packageJson.dependencies ?? {}, expectedRuntime, "runtime dependency");
	assertPins(packageJson.devDependencies ?? {}, expectedDev, "dev dependency");

	const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
	assert(lock.lockfileVersion === 3, "package-lock.json must use lockfileVersion 3");
	const root = lock.packages?.[""];
	assert(root !== undefined, "package-lock.json is missing the root package");
	assertPins(root.dependencies ?? {}, expectedRuntime, "locked runtime dependency");
	assertPins(root.devDependencies ?? {}, expectedDev, "locked dev dependency");
	for (const [name, version] of Object.entries({ ...expectedRuntime, ...expectedDev })) {
		assert(
			lock.packages?.[`node_modules/${name}`]?.version === version,
			`${name}@${version} is missing from package-lock`,
		);
	}
	const installScripts = new Set(
		Object.entries(lock.packages ?? {})
			.filter(([, entry]) => entry.hasInstallScript === true)
			.map(([packagePath]) => packagePath),
	);
	assert(
		JSON.stringify([...installScripts].sort()) === JSON.stringify([...approvedIgnoredInstallScripts].sort()),
		"package-lock lifecycle-script set differs from the reviewed --ignore-scripts allowlist",
	);

	const nvmrc = (await readFile(".nvmrc", "utf8")).trim();
	const pythonVersion = (await readFile(".python-version", "utf8")).trim();
	assert(nvmrc === expectedNode, `.nvmrc must be ${expectedNode}`);
	assert(pythonVersion === "3.12.9", ".python-version must be 3.12.9");

	await runCommand("uv", ["lock", "--check"]);
	await runCommand("uv", ["run", "--locked", "python", "scripts/python/check_dependencies.py"]);
}

main().catch(reportFailure);
