/** 官方下载适配器使用独立进程；测试只执行失败的本地解释器，不访问 catalog。 */

import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processEnvironment } from "../../src/adapters/sidecar-client.js";
import { OfficialGameCatalog } from "../../src/composition/official-catalog.js";

const temporary: string[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("official catalog process boundary", () => {
	it("uses an environment allowlist rather than guessing provider secret names", () => {
		expect(processEnvironment({ PATH: "/bin", HOME: "/private", CUSTOM_PROVIDER_CREDENTIAL: "secret" })).toEqual({
			PATH: "/bin",
		});
	});

	it.each([true, false])("passes only explicit ARC credentials to the fetching process (key=%s)", async (withKey) => {
		const root = await mkdtemp(path.join(os.tmpdir(), "pi-arc-catalog-probe-"));
		temporary.push(root);
		const packageRoot = path.join(root, "pi_arc_sidecar");
		const destination = path.join(root, "staging");
		await mkdir(packageRoot);
		await mkdir(destination);
		await writeFile(path.join(packageRoot, "__init__.py"), "");
		// 用本地探针替代官方 SDK；观察真实子进程收到的环境、cwd 和 argv。
		await writeFile(
			path.join(packageRoot, "catalog_fetch.py"),
			'import json, os, sys\nfrom pathlib import Path\nPath("probe.json").write_text(json.dumps({"env": dict(os.environ), "args": sys.argv[1:], "cwd": os.getcwd()}))\n',
		);
		for (const name of [
			"ARC_API_KEY",
			"ANTHROPIC_API_KEY",
			"CUSTOM_PROVIDER_CREDENTIAL",
			"PI_SESSION",
			"ARTIFACT_ROOT",
			"HTTPS_PROXY",
			"PI_ARC_SIDECAR_CRASH_AFTER_ACCEPT",
		]) {
			vi.stubEnv(name, name === "ARC_API_KEY" && !withKey ? "" : "must-not-leak");
		}
		const catalog = new OfficialGameCatalog(path.resolve(".venv/bin/python"), root);
		await expect(catalog.fetch("ls20-9607627b", "source", destination)).resolves.toEqual({
			gameId: "ls20-9607627b",
			sourceLocator: "source",
		});
		const probe = JSON.parse(await readFile(path.join(destination, "probe.json"), "utf8"));
		expect(probe.cwd).toBe(await realpath(destination));
		expect(probe.args).toEqual(["--game-id", "ls20-9607627b", "--destination", destination]);
		expect(probe.env.ARC_API_KEY).toBe(withKey ? "must-not-leak" : undefined);
		for (const name of [
			"HOME",
			"ANTHROPIC_API_KEY",
			"CUSTOM_PROVIDER_CREDENTIAL",
			"PI_SESSION",
			"ARTIFACT_ROOT",
			"HTTPS_PROXY",
			"PI_ARC_SIDECAR_CRASH_AFTER_ACCEPT",
		]) {
			expect(probe.env[name]).toBeUndefined();
		}
	});
	it("surfaces subprocess failure without reporting a fabricated Game receipt", async () => {
		const destination = await mkdtemp(path.join(os.tmpdir(), "pi-arc-catalog-error-"));
		temporary.push(destination);
		const catalog = new OfficialGameCatalog("/nonexistent/pi-arc-python", "/nonexistent/pi-arc-package");
		await expect(
			catalog.fetch("ls20-9607627b", "arc-agi://public/ls20-9607627b?sdk=0.9.9", destination),
		).rejects.toBeDefined();
	});
});
