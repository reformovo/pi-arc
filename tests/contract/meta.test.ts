import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function isMetaFixture(value: unknown): value is { schema: "pi-arc.meta-fixture.v1"; value: "ok" } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		Object.keys(record).sort().join(",") === "schema,value" &&
		record.schema === "pi-arc.meta-fixture.v1" &&
		record.value === "ok"
	);
}

async function fixture(name: string): Promise<unknown> {
	return JSON.parse(await readFile(new URL(`../fixtures/meta/${name}`, import.meta.url), "utf8"));
}

describe("cross-language contract plumbing", () => {
	it("accepts the valid meta fixture", async () => {
		expect(isMetaFixture(await fixture("valid.json"))).toBe(true);
	});

	it("rejects unknown fields", async () => {
		expect(isMetaFixture(await fixture("invalid.json"))).toBe(false);
	});
});
