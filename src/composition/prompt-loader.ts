/** 从独立 Markdown 资产读取并组合模型系统提示，不让 application 层依赖文件系统。 */

import { readFile } from "node:fs/promises";
import { composeModelSystemPrompt } from "../application/model-prompts.js";

export interface LoadedModelPrompt {
	vistaPrompt: string;
	addendum: string;
	systemPrompt: string;
}

/** 路径相对本模块固定；后续打包必须把两个 Markdown 文件随模块一起发布。 */
export async function loadModelSystemPrompt(): Promise<LoadedModelPrompt> {
	const [vistaPrompt, addendum] = await Promise.all([
		readFile(new URL("../application/prompts/prompt.md", import.meta.url), "utf8"),
		readFile(new URL("../application/prompts/pi-arc-addendum.md", import.meta.url), "utf8"),
	]);
	return { vistaPrompt, addendum, systemPrompt: composeModelSystemPrompt(vistaPrompt, addendum) };
}
