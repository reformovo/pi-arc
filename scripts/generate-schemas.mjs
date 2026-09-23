/**
 * 从唯一 source 生成可审阅的 JSON Schema 及其字节 digest。
 *
 * 生成文件属于公共 contract artifact。策略只能存在于 source.json 和本生成器中，
 * 避免手工修改的输出意外成为第二个 source。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { reportFailure } from "./lib/run-command.mjs";

const sourcePath = "schemas/source.json";
const outputRoot = "generated/schemas";

/** @param {string} schemaId */
function outputName(schemaId) {
	return `${schemaId.replaceAll(".", "-")}.schema.json`;
}

async function main() {
	/** @type {{ sourceVersion: number; schemas: Array<{ $id: string; [key: string]: unknown }> }} */
	const source = JSON.parse(await readFile(sourcePath, "utf8"));
	if (!Number.isInteger(source.sourceVersion) || source.sourceVersion !== 1) {
		throw new Error("schemas/source.json must declare sourceVersion 1");
	}
	if (!Array.isArray(source.schemas) || source.schemas.length === 0) {
		throw new Error("schemas/source.json must contain schemas");
	}
	await mkdir(outputRoot, { recursive: true });
	const seen = new Set();
	for (const schema of source.schemas) {
		if (typeof schema.$id !== "string" || seen.has(schema.$id)) throw new Error("schema ids must be unique strings");
		seen.add(schema.$id);
		const outputPath = path.join(outputRoot, outputName(schema.$id));
		await writeFile(outputPath, `${JSON.stringify(schema, null, "\t")}\n`, "utf8");
	}
	const manifestFiles = [];
	for (const schema of source.schemas) {
		const relativePath = `generated/schemas/${outputName(schema.$id)}`;
		const bytes = await readFile(relativePath);
		// digest 覆盖包括格式和末尾换行符在内的已发布字节，因为 consumer
		// 校验的是文件，而不是解析后的 JSON 值。
		manifestFiles.push({
			path: relativePath,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
	}
	await writeFile("generated-manifest.json", `${JSON.stringify({ files: manifestFiles }, null, "\t")}\n`, "utf8");
	process.stdout.write(`generated ${seen.size} schemas\n`);
}

main().catch(reportFailure);
