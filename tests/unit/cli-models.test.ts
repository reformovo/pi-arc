/** 无网络模型配置测试，不读取真实凭据。 */
import { describe, expect, it, vi } from "vitest";
import { createCliModels, InvalidCliModelConfiguration } from "../../src/composition/cli-models.js";

describe("CLI model endpoint configuration", () => {
	it("preserves the built-in catalog without an override", () => {
		for (const OPENAI_BASE_URL of [undefined, "", "  "]) {
			expect(createCliModels({ OPENAI_BASE_URL }).getModel("opencode-go", "deepseek-flash")).toBeUndefined();
		}
	});
	it("retains the Go adapter for custom endpoints", () => {
		const original = createCliModels({});
		const models = createCliModels({ OPENAI_BASE_URL: " https://custom.invalid/v1 " });
		expect(models.getModel("opencode-go", "deepseek-flash")).toEqual({
			...original.getModel("opencode-go", "deepseek-v4.1-flash"),
			id: "deepseek-flash",
			name: "DeepSeek Flash (VISTA)",
			baseUrl: "https://custom.invalid/v1",
		});
		expect(models.getModel("opencode-go", "minimax-m3")).toEqual(original.getModel("opencode-go", "minimax-m3"));
	});
	it.each([
		["https://api.deepseek.com", "deepseek"],
		["https://api.deepseek.com/v1", "deepseek"],
		["https://opencode.ai/zen/go/v1", "opencode-go"],
		["https://custom.invalid/v1", "opencode-go"],
		["https://api.deepseek.com.evil.invalid/v1", "opencode-go"],
	])("resolves only OPENAI_API_KEY for %s as %s", async (OPENAI_BASE_URL, provider) => {
		const models = createCliModels({ OPENAI_BASE_URL, OPENAI_API_KEY: "synthetic-key" });
		const model = models.getModel(provider, "deepseek-flash");
		if (!model) throw new Error("missing configured model");
		expect(await models.getAuth(model)).toMatchObject({
			auth: { apiKey: "synthetic-key" },
			source: "OPENAI_API_KEY",
		});
	});
	it("uses exact public DeepSeek metadata and preserves unrelated builtin credentials", async () => {
		vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
		vi.stubEnv("OPENCODE_API_KEY", "synthetic-opencode-key");
		try {
			const original = createCliModels({});
			const models = createCliModels({
				OPENAI_BASE_URL: "https://api.deepseek.com/v1",
				OPENAI_API_KEY: "synthetic-direct",
			});
			expect(models.getModel("deepseek", "deepseek-flash")).toEqual({
				...original.getModel("deepseek", "deepseek-flash"),
				baseUrl: "https://api.deepseek.com/v1",
			});
			for (const providerId of ["anthropic", "opencode-go", "openai"]) {
				const provider = models.getProvider(providerId);
				expect(provider?.getModels()).toEqual(original.getProvider(providerId)?.getModels());
				expect(provider?.auth.apiKey?.name).toBe(original.getProvider(providerId)?.auth.apiKey?.name);
				const model = provider?.getModels()[0];
				if (!model) throw new Error("missing builtin model");
				expect(await models.getAuth(model)).toEqual(await original.getAuth(model));
			}
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it.each(["https://api.deepseek.com", "https://opencode.ai/zen/go/v1"])(
		"rejects legacy-only credentials at %s",
		async (OPENAI_BASE_URL) => {
			vi.stubEnv("OPENCODE_API_KEY", "synthetic-legacy-only");
			vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-other-provider-key");
			try {
				const models = createCliModels({ OPENAI_BASE_URL });
				const model = models.getModel(
					OPENAI_BASE_URL.includes("deepseek.com") ? "deepseek" : "opencode-go",
					"deepseek-flash",
				);
				if (!model) throw new Error("missing model");
				expect(await models.getAuth(model)).toBeUndefined();
			} finally {
				vi.unstubAllEnvs();
			}
		},
	);
	it("rejects malformed URLs and embedded credentials", () => {
		for (const OPENAI_BASE_URL of [
			"invalid",
			"file:///tmp/api",
			"https://user:secret@example.com/v1",
			"https://example.com/v1?key=secret",
			"https://example.com/v1#key",
		]) {
			expect(() => createCliModels({ OPENAI_BASE_URL })).toThrow(InvalidCliModelConfiguration);
			try {
				createCliModels({ OPENAI_BASE_URL });
			} catch (error) {
				expect((error as Error).message).toBe("invalid OPENAI_BASE_URL");
			}
		}
	});
});
