/**
 * TypeScript 端的 Python sidecar 进程边界。
 *
 * 这个 adapter 只传输版本化 envelope，并把请求按顺序写入 stdin；它不解释
 * Environment 状态，也不把 sidecar 的 receipt 当作 Turn commit。controller
 * 必须独立保存 response payload 后才能完成后续事务。
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";

const PROCESS_KEYS = ["PATH", "SystemRoot", "WINDIR", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ"] as const;

/** 白名单只保留解释器运行配置；未知 provider 的凭据或 Pi 路径也不会被透传。 */
export function processEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const result: NodeJS.ProcessEnv = {};
	for (const key of PROCESS_KEYS) {
		if (source[key] !== undefined) result[key] = source[key];
	}
	return result;
}

export const SIDECAR_SCHEMA = "pi-arc.sidecar.v1" as const;
export type SidecarRequestType = "open" | "get_anchor" | "submit_action" | "lookup_action" | "close";
export type SidecarErrorCode =
	| "invalid_request"
	| "version_mismatch"
	| "instance_mismatch"
	| "anchor_conflict"
	| "action_conflict"
	| "unavailable"
	| "internal";

export interface SidecarRequest {
	schema: typeof SIDECAR_SCHEMA;
	requestId: string;
	type: SidecarRequestType;
	payload: Record<string, unknown>;
}

export interface SidecarResponse {
	schema: typeof SIDECAR_SCHEMA;
	requestId: string;
	type: SidecarRequestType;
	ok: boolean;
	payload?: Record<string, unknown>;
	error?: { code: SidecarErrorCode; message: string };
}

export interface SidecarProcessOptions {
	environmentRoot: string;
	cacheRoot: string;
	gameId: string;
	sourceLocator: string;
	treeDigest: string;
	seed: number;
	python?: string;
	pythonPath?: string;
	spawnEnv?: NodeJS.ProcessEnv;
}

export class SidecarProtocolError extends Error {
	readonly code = "sidecar_protocol_error";
}

export class SidecarRemoteError extends Error {
	readonly code: SidecarErrorCode;

	constructor(code: SidecarErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestType(value: unknown): value is SidecarRequestType {
	return (
		value === "open" ||
		value === "get_anchor" ||
		value === "submit_action" ||
		value === "lookup_action" ||
		value === "close"
	);
}

function parseResponse(value: unknown): SidecarResponse {
	if (!isRecord(value)) throw new SidecarProtocolError("sidecar response must be an object");
	if (value.schema !== SIDECAR_SCHEMA || typeof value.requestId !== "string" || !isRequestType(value.type)) {
		throw new SidecarProtocolError("sidecar response envelope is invalid");
	}
	if (typeof value.ok !== "boolean" || (value.payload !== undefined && !isRecord(value.payload))) {
		throw new SidecarProtocolError("sidecar response success fields are invalid");
	}
	if (value.error !== undefined) {
		if (!isRecord(value.error) || typeof value.error.code !== "string" || typeof value.error.message !== "string") {
			throw new SidecarProtocolError("sidecar error is invalid");
		}
		if (
			!"invalid_request version_mismatch instance_mismatch anchor_conflict action_conflict unavailable internal"
				.split(" ")
				.includes(value.error.code)
		) {
			throw new SidecarProtocolError("sidecar error code is unknown");
		}
	}
	if (value.ok && value.payload === undefined) throw new SidecarProtocolError("successful response has no payload");
	if (!value.ok && value.error === undefined) throw new SidecarProtocolError("rejected response has no error");
	if (value.ok && value.error !== undefined) throw new SidecarProtocolError("successful response has an error");
	if (!value.ok && value.payload !== undefined) throw new SidecarProtocolError("rejected response has a payload");
	return value as unknown as SidecarResponse;
}

/** 用确定的参数启动一个受限 sidecar 子进程。 */
export class SidecarClient {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly lines: Interface;
	private readonly pending = new Map<
		string,
		{ type: SidecarRequestType; resolve: (response: SidecarResponse) => void; reject: (error: Error) => void }
	>();
	private sequence = 0;
	private closed = false;
	private readonly exited: Promise<void>;
	private readonly openPayload: Record<string, unknown>;

	constructor(options: SidecarProcessOptions) {
		this.openPayload = {
			gameId: options.gameId,
			sourceLocator: options.sourceLocator,
			treeDigest: options.treeDigest,
			seed: options.seed,
		};
		const python = options.python ?? ".venv/bin/python";
		const cacheRoot = path.resolve(options.cacheRoot);
		mkdirSync(cacheRoot, { recursive: true });
		const childEnv = processEnvironment({ ...process.env, ...options.spawnEnv });
		// 故障注入只允许调用者显式传入；宿主环境不能改变正式 Run 的执行行为。
		if (options.spawnEnv?.PI_ARC_SIDECAR_CRASH_AFTER_ACCEPT === "1") {
			childEnv.PI_ARC_SIDECAR_CRASH_AFTER_ACCEPT = "1";
		}
		childEnv.PI_ARC_BLOCK_NETWORK = "1";
		childEnv.PYTHONPATH = path.resolve(options.pythonPath ?? "python");
		this.child = spawn(
			python.includes(path.sep) ? path.resolve(python) : python,
			[
				"-m",
				"pi_arc_sidecar.sidecar",
				"--environment-root",
				path.resolve(options.environmentRoot),
				"--cache-root",
				cacheRoot,
				"--game-id",
				options.gameId,
				"--seed",
				String(options.seed),
				"--source-locator",
				options.sourceLocator,
				"--tree-digest",
				options.treeDigest,
			],
			{
				env: childEnv,
				// SDK import 会读取 cwd 的 .env；不能让它重新引入宿主凭据。
				cwd: cacheRoot,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		this.exited = new Promise((resolve) => {
			this.child.once("close", () => resolve());
		});
		this.lines = createInterface({ input: this.child.stdout });
		// 丢弃 sidecar 诊断 stderr，避免 Game code 的日志填满 pipe 阻塞协议。
		this.child.stderr.resume();
		this.lines.on("line", (line) => this.handleLine(line));
		this.child.on("error", (error) => this.rejectAll(error));
		this.child.on("close", (code, signal) => {
			this.rejectAll(new Error(`sidecar exited (code=${String(code)}, signal=${String(signal)})`));
		});
	}

	/** 用进程启动参数和 wire payload 同时绑定 Game cache。 */
	open(): Promise<Record<string, unknown>> {
		return this.request("open", this.openPayload);
	}

	private handleLine(line: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			this.rejectAll(new SidecarProtocolError("sidecar emitted non-JSON output"));
			return;
		}
		let response: SidecarResponse;
		try {
			response = parseResponse(parsed);
		} catch (error) {
			this.rejectAll(error instanceof Error ? error : new SidecarProtocolError("sidecar response parse failed"));
			return;
		}
		const waiter = this.pending.get(response.requestId);
		if (waiter === undefined) {
			this.rejectAll(new SidecarProtocolError(`unexpected sidecar requestId ${response.requestId}`));
			return;
		}
		if (response.type !== waiter.type) {
			this.pending.delete(response.requestId);
			waiter.reject(new SidecarProtocolError("sidecar response type does not match request"));
			return;
		}
		this.pending.delete(response.requestId);
		if (response.ok) waiter.resolve(response);
		else
			waiter.reject(
				new SidecarRemoteError(
					response.error?.code ?? "internal",
					response.error?.message ?? "sidecar request failed",
				),
			);
	}

	private rejectAll(error: Error): void {
		for (const waiter of this.pending.values()) waiter.reject(error);
		this.pending.clear();
	}

	/** 发送一个 request；同一 client 内不允许并行请求。 */
	async request(type: SidecarRequestType, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
		if (this.closed) throw new Error("sidecar client is closed");
		if (this.pending.size > 0) throw new Error("sidecar requests must be strictly serial");
		const request: SidecarRequest = { schema: SIDECAR_SCHEMA, requestId: `r${++this.sequence}`, type, payload };
		const response = await new Promise<SidecarResponse>((resolve, reject) => {
			this.pending.set(request.requestId, { type, resolve, reject });
			this.child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
				if (error != null) {
					this.pending.delete(request.requestId);
					reject(error);
				}
			});
		});
		return response.payload ?? {};
	}

	/** 关闭 sidecar，确保子进程和 readline 资源都被回收。 */
	async close(): Promise<void> {
		if (this.closed) return this.exited;
		this.closed = true;
		this.lines.close();
		this.child.stdin.end();
		if (!this.child.killed) this.child.kill();
		await this.exited;
	}
}
