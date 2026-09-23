export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function compareCodePoints(left: string, right: string): number {
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
		if (!Number.isSafeInteger(value)) throw new TypeError("canonical JSON only accepts safe integer numbers");
		return String(value);
	}
	if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
	if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		throw new TypeError("unsupported JSON value");
	const keys = Object.keys(value).sort(compareCodePoints);
	return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(value[key] as JsonValue)}`).join(",")}}`;
}

export function canonicalJson(value: JsonValue): string {
	return `${encode(value)}\n`;
}

export function canonicalJsonBytes(value: JsonValue): Uint8Array {
	return new TextEncoder().encode(canonicalJson(value));
}
