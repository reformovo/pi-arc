import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canonicalJsonDigest } from "../../src/adapters/sha256.js";
import { canonicalJson, type JsonValue } from "../../src/protocol/canonical-json.js";
import { isValidJsonSchema } from "../../src/protocol/schema-validator.js";

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

describe("canonical JSON contract", () => {
	it("matches every fixed cross-language vector", async () => {
		const vectors = await loadJson<CanonicalVector[]>("../fixtures/contracts/canonical-vectors.json");
		for (const vector of vectors) {
			expect(canonicalJson(vector.value), vector.name).toBe(vector.canonical);
			expect(canonicalJsonDigest(vector.value), vector.name).toBe(vector.digest);
		}
	});
});

describe("versioned schema corpus", () => {
	it("accepts and rejects the same cases as the corpus declares", async () => {
		const cases = await loadJson<SchemaCase[]>("../fixtures/contracts/schema-corpus.json");
		for (const testCase of cases) {
			const schema = await loadJson<unknown>(schemaFile(testCase.schema));
			expect(isValidJsonSchema(testCase.value, schema), testCase.name).toBe(testCase.valid);
		}
	});
});
