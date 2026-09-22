import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		fileParallelism: false,
		include: ["tests/integration/**/*.test.ts"],
		passWithNoTests: false,
		restoreMocks: true,
		setupFiles: ["tests/support/vitest-network-setup.ts"],
		testTimeout: 10_000,
	},
});
