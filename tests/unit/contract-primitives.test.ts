import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canonicalJsonDigest } from "../../src/adapters/sha256.js";
import { canonicalJson, type JsonValue } from "../../src/protocol/canonical-json.js";
import { isValidJsonSchema, validateJsonSchema } from "../../src/protocol/schema-validator.js";

interface CanonicalVector {
	name: string;
	value: JsonValue;
	canonical: string;
	digest: string;
}

interface SchemaCase {
	name: string;
	schema: string;
	valid: boolean;
	value: unknown;
}

async function loadJson<T>(relativePath: string): Promise<T> {
	return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8")) as T;
}

function schemaFile(schemaId: string): string {
	return `../../generated/schemas/${schemaId.replaceAll(".", "-")}.schema.json`;
}

describe("contract primitives", () => {
	it("matches canonical vectors and rejects unsupported numbers", async () => {
		const vectors = await loadJson<CanonicalVector[]>("../fixtures/contracts/canonical-vectors.json");
		for (const vector of vectors) {
			expect(canonicalJson(vector.value), vector.name).toBe(vector.canonical);
			expect(canonicalJsonDigest(vector.value), vector.name).toBe(vector.digest);
		}
		expect(() => canonicalJson(9007199254740992)).toThrow("safe integer");
		expect(() => canonicalJson(1.5)).toThrow("safe integer");
		expect(() => canonicalJson(new Date() as never)).toThrow("unsupported JSON value");
	});

	it("matches every schema corpus case", async () => {
		const cases = await loadJson<SchemaCase[]>("../fixtures/contracts/schema-corpus.json");
		for (const testCase of cases) {
			const schema = await loadJson<unknown>(schemaFile(testCase.schema));
			expect(isValidJsonSchema(testCase.value, schema), testCase.name).toBe(testCase.valid);
		}
	});

	it("reports validator edge conditions", () => {
		expect(validateJsonSchema({}, { type: "object", required: ["required"] })).not.toHaveLength(0);
		expect(validateJsonSchema(1, { type: "string" })).not.toHaveLength(0);
		expect(validateJsonSchema([], { type: "array", minItems: 1 })).not.toHaveLength(0);
		expect(
			validateJsonSchema(
				{ known: 1, unknown: 2 },
				{ type: "object", additionalProperties: false, properties: { known: { type: "integer" } } },
			),
		).not.toHaveLength(0);
		expect(validateJsonSchema("bad", { type: ["integer", "null"] })).not.toHaveLength(0);
		expect(
			validateJsonSchema(
				{ x: 1 },
				{ type: "object", properties: { x: { type: "integer", minimum: 2, maximum: 0 } } },
			),
		).not.toHaveLength(0);
	});
});
