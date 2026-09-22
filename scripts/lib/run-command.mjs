import { spawn } from "node:child_process";

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<void>}
 */
export function runCommand(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			cwd: options.cwd,
			env: options.env,
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			const suffix = signal === null ? `exit ${String(code)}` : `signal ${signal}`;
			reject(new Error(`${command} ${args.join(" ")} failed with ${suffix}`));
		});
	});
}

/** @param {unknown} error */
export function reportFailure(error) {
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`${message}\n`);
	process.exitCode = 1;
}
