/** 官方 ARC SDK 下载边界；只有 cache miss 才创建独立 Python 获取进程。 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GameCatalogPort, GameCatalogReceipt } from "../adapters/game-resolver.js";
import { processEnvironment } from "../adapters/sidecar-client.js";

const runFile = promisify(execFile);

export class OfficialGameCatalog implements GameCatalogPort {
	constructor(
		private readonly python: string,
		private readonly pythonPath: string,
	) {}

	async fetch(gameId: string, sourceLocator: string, destination: string): Promise<GameCatalogReceipt> {
		// 官方 SDK 下载期间可能加载 Game code；该进程与模型和 Run artifact 隔离。
		await runFile(
			this.python,
			["-m", "pi_arc_sidecar.catalog_fetch", "--game-id", gameId, "--destination", destination],
			{
				// 只允许 ARC 获取凭据；不继承 HOME、模型凭据、proxy 或 Pi 配置。
				env: {
					...processEnvironment(process.env),
					...(process.env.ARC_API_KEY ? { ARC_API_KEY: process.env.ARC_API_KEY } : {}),
					PYTHONPATH: this.pythonPath,
				},
				cwd: destination,
				timeout: 60_000,
				maxBuffer: 64 * 1024,
			},
		);
		return { gameId, sourceLocator };
	}
}
