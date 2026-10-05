#!/usr/bin/env node
/**
 * 无头 CLI：只把 SDK 的持久事件投影到 stdout JSONL。
 *
 * 静态 flag 失败与 Run 前置检查分别使用退出码 2/3；stderr 仅用于人类
 * 诊断，不混入机器可读记录。audit 不创建 Environment 或模型 runtime。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { FULL_GAME_ID } from "../adapters/game-resolver.js";
import type { JsonValue } from "../protocol/canonical-json.js";
import { createPiArcHost } from "./index.js";
import type { PiArcHost, RunInvocationResult, RunRequest, RunResult } from "./pi-arc-host.js";
import type { RunEvent, RunEventType } from "./run-events.js";

export interface CliIo {
	stdout(text: string): void;
	stderr(text: string): void;
}

const defaultIo: CliIo = {
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
};

const flagNames = new Set([
	"--game-id",
	"--game-cache",
	"--provider",
	"--model",
	"--artifacts",
	"--game-offline",
	"--thinking",
	"--action-budget",
]);

function finalEvent(
	sequence: number,
	runId: string | null,
	type: RunEventType,
	data: Record<string, JsonValue>,
	now: () => string,
): RunEvent {
	return { schema: "pi-arc.cli-event.v1", sequence, occurredAt: now(), runId, type, data };
}

function exitCode(result: RunResult): number {
	if (
		!result.audit.ok ||
		result.outcomeClass === "audit_failure" ||
		result.terminationReason === "controller_failure" ||
		result.terminationReason === "evidence_corrupt"
	)
		return 30;
	if (result.outcomeClass === "win") return 0;
	if (result.outcomeClass === "unknown_outcome") return 20;
	return 10;
}

function parseFlags(command: string, args: string[]): Map<string, string> | null {
	const allowed = command === "run" ? flagNames : new Set(["--artifacts"]);
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];
		if (flag === undefined || !allowed.has(flag) || values.has(flag)) return null;
		if (flag === "--game-offline") {
			values.set(flag, "true");
			continue;
		}
		const value = args[++index];
		if (value === undefined || value.length === 0 || value.startsWith("--")) return null;
		values.set(flag, value);
	}
	if (!values.has("--artifacts")) return null;
	if (command === "run" && !["--game-id", "--game-cache", "--provider", "--model"].every((flag) => values.has(flag)))
		return null;
	return values;
}

/** 测试注入 faux host 与 I/O；生产入口仅使用公开 pi-ai Models。 */
export async function runCli(
	argv: string[],
	host: PiArcHost,
	io: CliIo = defaultIo,
	now: () => string = () => new Date().toISOString(),
): Promise<number> {
	const [command, ...args] = argv;
	if (command !== "run" && command !== "resume" && command !== "audit") {
		io.stdout(`${JSON.stringify(finalEvent(1, null, "run.rejected", { reason: "invalid_command" }, now))}\n`);
		io.stderr("pi-arc: expected run, resume or audit\n");
		return 2;
	}
	const flags = parseFlags(command, args);
	if (flags === null) {
		io.stdout(`${JSON.stringify(finalEvent(1, null, "run.rejected", { reason: "invalid_flags" }, now))}\n`);
		io.stderr("pi-arc: invalid flags\n");
		return 2;
	}
	const artifactRoot = flags.get("--artifacts") as string;
	if (command === "audit") {
		try {
			const report = await host.audit(artifactRoot);
			let outcomeCode = 30;
			if (report.ok) {
				const terminal = JSON.parse(await readFile(path.join(artifactRoot, "terminal.json"), "utf8")) as {
					outcomeClass: string;
				};
				outcomeCode = terminal.outcomeClass === "win" ? 0 : terminal.outcomeClass === "unknown_outcome" ? 20 : 10;
			}
			let sequence = 0;
			for (const finding of report.findings) {
				io.stdout(`${JSON.stringify(finalEvent(++sequence, report.runId, "audit.finding", finding, now))}\n`);
			}
			io.stdout(
				`${JSON.stringify(finalEvent(++sequence, report.runId, "audit.completed", { ok: report.ok, manifestDigest: report.manifestDigest, ledgerHead: report.ledgerHead }, now))}\n`,
			);
			return outcomeCode;
		} catch {
			io.stdout(
				`${JSON.stringify(finalEvent(1, null, "audit.completed", { ok: false, reason: "archive_invalid" }, now))}\n`,
			);
			return 30;
		}
	}

	let invocation: RunInvocationResult;
	if (command === "run") {
		const budgetText = flags.get("--action-budget");
		const thinking = flags.get("--thinking");
		if (thinking !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking)) {
			io.stdout(`${JSON.stringify(finalEvent(1, null, "run.rejected", { reason: "invalid_thinking" }, now))}\n`);
			return 2;
		}
		if (budgetText !== undefined && (!/^[1-9][0-9]*$/.test(budgetText) || Number(budgetText) > 999_999)) {
			io.stdout(
				`${JSON.stringify(finalEvent(1, null, "run.rejected", { reason: "invalid_action_budget" }, now))}\n`,
			);
			return 2;
		}
		if (!FULL_GAME_ID.test(flags.get("--game-id") as string)) {
			io.stdout(`${JSON.stringify(finalEvent(1, null, "run.rejected", { reason: "invalid_game_id" }, now))}\n`);
			return 2;
		}
		const request: RunRequest = {
			gameId: flags.get("--game-id") as string,
			gameCache: flags.get("--game-cache") as string,
			provider: flags.get("--provider") as string,
			modelId: flags.get("--model") as string,
			artifactRoot,
			...(flags.has("--game-offline") ? { gameOffline: true } : {}),
			...(thinking === undefined ? {} : { thinkingLevel: thinking as NonNullable<RunRequest["thinkingLevel"]> }),
			...(budgetText === undefined ? {} : { actionBudget: Number(budgetText) }),
		};
		invocation = await host.run(request);
	} else invocation = await host.resume({ artifactRoot });
	if (invocation.status === "rejected") {
		io.stdout(`${JSON.stringify(finalEvent(1, null, "run.rejected", { reason: invocation.reason }, now))}\n`);
		io.stderr(`pi-arc: ${invocation.reason}\n`);
		return invocation.reason === "invalid_request"
			? 2
			: ["archive_invalid", "controller_failure", "evidence_corrupt"].includes(invocation.reason)
				? 30
				: 3;
	}
	const events: RunEvent[] = [];
	try {
		for await (const event of host.readEvents(artifactRoot)) events.push(event);
	} catch {
		io.stderr("pi-arc: event archive is corrupt\n");
		io.stdout(
			`${JSON.stringify(
				finalEvent(
					1,
					invocation.result.runId,
					"run.completed",
					{
						outcomeClass: "audit_failure",
						terminationReason: "evidence_corrupt",
						artifactRoot,
					},
					now,
				),
			)}\n`,
		);
		return 30;
	}
	// 已终止 resume 不改写 archive；缺尾或本次审计发现损坏时，只投影当前结果。
	if (events.at(-1)?.type !== "run.completed" || events.at(-1)?.data.outcomeClass !== invocation.result.outcomeClass) {
		events.push(
			finalEvent(
				events.length + 1,
				invocation.result.runId,
				"run.completed",
				{
					game: invocation.result.game,
					outcomeClass: invocation.result.outcomeClass,
					terminationReason: invocation.result.terminationReason,
					artifactRoot,
				},
				now,
			),
		);
	}
	for (const event of events) io.stdout(`${JSON.stringify(event)}\n`);
	return exitCode(invocation.result);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	runCli(process.argv.slice(2), createPiArcHost(builtinModels())).then(
		(code) => {
			process.exitCode = code;
		},
		() => {
			process.stderr.write("pi-arc: unexpected CLI failure\n");
			process.exitCode = 30;
		},
	);
}
