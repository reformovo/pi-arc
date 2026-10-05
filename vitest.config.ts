import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			clean: true,
			exclude: [],
			include: ["src/**/*.ts"],
			provider: "v8",
			reporter: ["text", "json"],
			reportsDirectory: "coverage/typescript",
			thresholds: {
				branches: 85,
				functions: 90,
				lines: 90,
				statements: 90,
			},
		},
		include: [
			"tests/unit/**/*.test.ts",
			"tests/integration/sidecar.test.ts",
			"tests/integration/pi-runtime.test.ts",
			"tests/integration/cli-sdk.test.ts",
		],
		passWithNoTests: false,
		restoreMocks: true,
		setupFiles: ["tests/support/vitest-network-setup.ts"],
	},
});
