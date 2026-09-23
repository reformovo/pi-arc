/**
 * 把纯领域 Visual 编码并发布为稳定的 PNG artifact。
 *
 * 编码器只写 RGB、8-bit、无 metadata 的 PNG，并固定 filter 与压缩参数；
 * publisher 使用 `.partial` 后 rename，且只接受内容相同的幂等重试。
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { DISPLAY_SIZE, type Visual } from "../domain/game-visual.js";

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const textEncoder = new TextEncoder();

/** PNG 文件发布所需的最小可注入 filesystem port。 */
export interface VisualPngIo {
	mkdir(directory: string): Promise<void>;
	readFile(file: string): Promise<Uint8Array>;
	writeFile(file: string, content: Uint8Array): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

const nodeVisualPngIo: VisualPngIo = {
	mkdir: async (directory) => {
		await mkdir(directory, { recursive: true });
	},
	readFile,
	writeFile,
	rename,
};

/** 已有 Visual PNG 与本次发布内容冲突。 */
export class VisualPngConflictError extends Error {
	readonly code = "visual_png_conflict";
}

function uint32(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value >>> 0);
	return bytes;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
	const total = parts.reduce((length, part) => length + part.length, 0);
	const output = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: "IDAT" | "IEND" | "IHDR", data: Uint8Array): Uint8Array {
	const typeBytes = textEncoder.encode(type);
	return concatenate([uint32(data.length), typeBytes, data, uint32(crc32(concatenate([typeBytes, data])))]);
}

function assertVisual(visual: Visual): void {
	if (
		!Number.isSafeInteger(visual.width) ||
		!Number.isSafeInteger(visual.height) ||
		visual.width < 1 ||
		visual.height < 1 ||
		visual.rgb.length !== visual.width * visual.height * 3
	) {
		throw new TypeError("Visual dimensions do not match its RGB bytes");
	}
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isMissing(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function pad(value: number): string {
	return String(value).padStart(6, "0");
}

/**
 * 将任意合法 RGB Visual 编码为确定性 PNG 字节。
 * 每行固定使用 filter 0；无时间戳、文本块或其他可变 metadata。
 */
export function encodeVisualPng(visual: Visual): Uint8Array {
	assertVisual(visual);
	const header = new Uint8Array(13);
	const headerView = new DataView(header.buffer);
	headerView.setUint32(0, visual.width);
	headerView.setUint32(4, visual.height);
	header[8] = 8;
	header[9] = 2;
	header[10] = 0;
	header[11] = 0;
	header[12] = 0;

	const stride = visual.width * 3;
	const scanlines = new Uint8Array((stride + 1) * visual.height);
	for (let row = 0; row < visual.height; row += 1) {
		const targetOffset = row * (stride + 1);
		scanlines[targetOffset] = 0;
		scanlines.set(visual.rgb.subarray(row * stride, (row + 1) * stride), targetOffset + 1);
	}
	const compressed = deflateSync(scanlines, { level: 9 });
	return concatenate([
		PNG_SIGNATURE,
		chunk("IHDR", header),
		chunk("IDAT", compressed),
		chunk("IEND", new Uint8Array()),
	]);
}

/** 返回 Visual 在 Run artifact root 中的稳定相对路径。 */
export function visualPngPath(turn: number, frame: number): string {
	if (!Number.isSafeInteger(turn) || !Number.isSafeInteger(frame) || turn < 0 || frame < 0) {
		throw new TypeError("Visual turn and frame must be non-negative safe integers");
	}
	return path.posix.join("visuals", `t${pad(turn)}`, `f${pad(frame)}.png`);
}

/** single-writer Visual PNG publisher，支持内容相同的幂等 retry。 */
export class VisualPngPublisher {
	private readonly root: string;
	private readonly io: VisualPngIo;

	/** 绑定一个 Run artifact root 和可选的 fault-injectable I/O port。 */
	constructor(root: string, io: VisualPngIo = nodeVisualPngIo) {
		this.root = path.resolve(root);
		this.io = io;
	}

	/** 编码并原子发布一个固定 1024×1024 的归档 Visual。 */
	async publish(turn: number, frame: number, visual: Visual): Promise<string> {
		if (visual.width !== DISPLAY_SIZE || visual.height !== DISPLAY_SIZE) {
			throw new TypeError("Archived Visual must be 1024x1024");
		}
		const relativePath = visualPngPath(turn, frame);
		const target = path.join(this.root, relativePath);
		const bytes = encodeVisualPng(visual);
		await this.io.mkdir(path.dirname(target));
		try {
			const existing = await this.io.readFile(target);
			if (!bytesEqual(existing, bytes)) throw new VisualPngConflictError(`${relativePath} is write-once`);
			return relativePath;
		} catch (error) {
			if (!isMissing(error)) throw error;
		}
		// target 只在 rename 时可见。crash 会留下 `.partial`，供独立 audit 报告。
		const temporary = `${target}.partial`;
		await this.io.writeFile(temporary, bytes);
		await this.io.rename(temporary, target);
		return relativePath;
	}
}
