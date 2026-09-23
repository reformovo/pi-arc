/**
 * 严格校验 pi-arc 有意限定的 JSON Schema 子集。
 *
 * 这里不是通用 JSON Schema engine。新增 schema keyword 时，必须同时实现
 * TypeScript/Python 支持，并加入共享的 valid/invalid contract fixture。
 */

import { canonicalJson } from "./canonical-json.js";

type SchemaObject = { [key: string]: unknown };

function isRecord(value: unknown): value is SchemaObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (typeof value === "number") return Number.isSafeInteger(value) ? "integer" : "number";
	return typeof value;
}

function matchesType(value: unknown, expected: unknown): boolean {
	if (typeof expected === "string") {
		if (expected === "number") return typeof value === "number" && Number.isFinite(value);
		if (expected === "integer") return typeof value === "number" && Number.isSafeInteger(value);
		return valueType(value) === expected;
	}
	if (Array.isArray(expected)) return expected.some((item) => matchesType(value, item));
	return true;
}

function equals(left: unknown, right: unknown): boolean {
	// 结构化 const/enum 使用规范化 JSON 比较，避免 mapping key 的插入顺序
	// 导致 TypeScript 和 Python 对同一 JSON 值得出不同结论。
	if (isRecord(left) && isRecord(right)) return canonicalJson(left as never) === canonicalJson(right as never);
	if (Array.isArray(left) && Array.isArray(right))
		return canonicalJson(left as never) === canonicalJson(right as never);
	return Object.is(left, right);
}

function validate(value: unknown, schema: SchemaObject, path: string, errors: string[]): void {
	if ("const" in schema && !equals(value, schema.const)) errors.push(`${path}: does not match const`);
	if (Array.isArray(schema.enum) && !schema.enum.some((item) => equals(value, item)))
		errors.push(`${path}: unknown enum value`);
	if (schema.type !== undefined && !matchesType(value, schema.type)) {
		errors.push(`${path}: expected ${JSON.stringify(schema.type)}, got ${valueType(value)}`);
		return;
	}
	if (typeof value === "string") {
		if (typeof schema.minLength === "number" && [...value].length < schema.minLength)
			errors.push(`${path}: string too short`);
		if (typeof schema.maxLength === "number" && [...value].length > schema.maxLength)
			errors.push(`${path}: string too long`);
		if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value))
			errors.push(`${path}: pattern mismatch`);
	}
	if (typeof value === "number") {
		if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path}: below minimum`);
		if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path}: above maximum`);
	}
	if (Array.isArray(value)) {
		if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${path}: too few items`);
		if (isRecord(schema.items)) {
			value.forEach((item, index) => {
				validate(item, schema.items as SchemaObject, `${path}[${index}]`, errors);
			});
		}
	}
	if (!isRecord(value)) return;
	const properties = isRecord(schema.properties) ? schema.properties : {};
	if (Array.isArray(schema.required)) {
		for (const required of schema.required) {
			if (typeof required === "string" && !(required in value)) errors.push(`${path}: missing ${required}`);
		}
	}
	if (schema.additionalProperties === false) {
		for (const key of Object.keys(value)) if (!(key in properties)) errors.push(`${path}: unknown field ${key}`);
	}
	for (const [key, propertySchema] of Object.entries(properties)) {
		if (key in value && isRecord(propertySchema)) validate(value[key], propertySchema, `${path}.${key}`, errors);
	}
}

/** 返回受支持 schema 子集产生的全部校验错误。 */
export function validateJsonSchema(value: unknown, schema: unknown): string[] {
	const errors: string[] = [];
	if (!isRecord(schema)) return ["$: schema is not an object"];
	validate(value, schema, "$", errors);
	return errors;
}

/** 使用受支持的 schema 子集检查值，但不暴露具体错误。 */
export function isValidJsonSchema(value: unknown, schema: unknown): boolean {
	return validateJsonSchema(value, schema).length === 0;
}
