import { createHash } from "node:crypto";
import { canonicalJsonBytes, type JsonValue } from "../protocol/canonical-json.js";

export function canonicalJsonDigest(value: JsonValue): string {
	return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}
