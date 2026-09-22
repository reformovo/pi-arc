import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/contract/**/*.test.ts"],
		passWithNoTests: false,
		restoreMocks: true,
		setupFiles: ["tests/support/vitest-network-setup.ts"],
	},
});
