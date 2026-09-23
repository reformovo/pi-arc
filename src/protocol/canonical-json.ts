/**
 * 为所有带 digest 的 pi-arc contract 提供共享的规范化 JSON 编码。
 *
 * 本模块只负责字节的确定性；哈希算法选择和持久化由 adapter 负责，
 * 从而让 protocol 层不依赖 Node 和存储 API。
 */

/** 带版本的 pi-arc protocol 和 artifact record 可接受的 JSON 基础值。 */
export type JsonPrimitive = boolean | null | number | string;

/** 规范化协议编码可接受的递归 JSON 结构。 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function compareCodePoints(left: string, right: string): number {
	// JavaScript 默认按 UTF-16 code unit 排序字符串；显式按 Unicode code point
	// 排序，才能让增补平面字符与 Python 及 accepted contract 保持一致。
	const leftPoints = [...left];
	const rightPoints = [...right];
	for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
		const leftPoint = leftPoints[index];
		const rightPoint = rightPoints[index];
		if (leftPoint === rightPoint) continue;
		return (leftPoint?.codePointAt(0) ?? 0) - (rightPoint?.codePointAt(0) ?? 0);
	}
	return leftPoints.length - rightPoints.length;
}

function encode(value: JsonValue): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		// 跨语言 record 只接受 JavaScript safe integer；拒绝浮点数可避免
		// JavaScript 与 Python runtime 对同一个数字产生不同的文本表示。
		if (!Number.isSafeInteger(value)) throw new TypeError("canonical JSON only accepts safe integer numbers");
		return String(value);
	}
	if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
	if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		throw new TypeError("unsupported JSON value");
	const keys = Object.keys(value).sort(compareCodePoints);
	return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(value[key] as JsonValue)}`).join(",")}}`;
}

/** 返回 `value` 唯一的紧凑 JSON 文本，并确保末尾恰有一个换行符。 */
export function canonicalJson(value: JsonValue): string {
	return `${encode(value)}\n`;
}

/** 将规范化 JSON 编码为 pi-arc SHA-256 digest 所覆盖的 UTF-8 字节。 */
export function canonicalJsonBytes(value: JsonValue): Uint8Array {
	return new TextEncoder().encode(canonicalJson(value));
}
