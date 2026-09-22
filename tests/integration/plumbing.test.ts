import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface MetaResponse {
	networkBlocked: boolean;
	schema: string;
	secretPresent: boolean;
	value: string;
}

function cleanEnvironment(secret: string): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (/(?:API_KEY|AUTHORIZATION|OAUTH|TOKEN|SECRET)/i.test(key)) delete env[key];
	}
	env.PI_ARC_BLOCK_NETWORK = "1";
	delete env.PI_ARC_TEST_SECRET;
	env.PYTHONPATH = path.resolve("tests/support/python");
	expect(Object.values(env)).not.toContain(secret);
	return env;
}

async function runMetaSidecar(secret: string): Promise<{ output: string; response: MetaResponse }> {
	const child = spawn("uv", ["run", "--locked", "python", "tests/support/meta_sidecar.py"], {
		env: cleanEnvironment(secret),
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
		stdout += chunk;
	});
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
		stderr += chunk;
	});
	child.stdin.end(`${JSON.stringify({ probeNetwork: true, value: "ok" })}\n`);
	const code = await new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	if (code !== 0) throw new Error(`meta sidecar exited ${String(code)}: ${stderr}`);
	const parsed: unknown = JSON.parse(stdout);
	if (typeof parsed !== "object" || parsed === null) throw new Error("meta sidecar returned a non-object");
	const record = parsed as Record<string, unknown>;
	const response: MetaResponse = {
		networkBlocked: record.networkBlocked === true,
		schema: typeof record.schema === "string" ? record.schema : "",
		secretPresent: record.secretPresent === true,
		value: typeof record.value === "string" ? record.value : "",
	};
	return { output: `${stdout}${stderr}`, response };
}

describe("offline integration plumbing", () => {
	it("blocks deliberate Node fetch and socket access", async () => {
		await expect(fetch("https://example.invalid")).rejects.toThrow("network disabled");
		expect(() => new net.Socket().connect(9, "127.0.0.1")).toThrow("network disabled");
	});

	it("runs a sanitized Python process with its network sentinel active", async () => {
		const secret = "PI_ARC_SENTINEL_DO_NOT_LEAK";
		process.env.PI_ARC_TEST_SECRET = secret;
		try {
			const { output, response } = await runMetaSidecar(secret);
			expect(response).toEqual({
				networkBlocked: true,
				schema: "pi-arc.meta-plumbing.v1",
				secretPresent: false,
				value: "ok",
			});
			expect(output).not.toContain(secret);
		} finally {
			delete process.env.PI_ARC_TEST_SECRET;
		}
	});
});
