/** 显式构建 SDK/CLI；required checks 只读，不调用本脚本。 */

import { chmod, cp, mkdir } from "node:fs/promises";
import { reportFailure, runCommand } from "./lib/run-command.mjs";

async function main() {
	await runCommand("node_modules/.bin/tsc", ["-p", "tsconfig.build.json"]);
	await mkdir("dist/application/prompts", { recursive: true });
	await cp("src/application/prompts/prompt.md", "dist/application/prompts/prompt.md");
	await cp("src/application/prompts/pi-arc-addendum.md", "dist/application/prompts/pi-arc-addendum.md");
	await chmod("dist/composition/cli.js", 0o755);
}

main().catch(reportFailure);
