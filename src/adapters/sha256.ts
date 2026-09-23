/** 为 pi-arc 规范化协议值提供 Node SHA-256 适配器。 */

import { createHash } from "node:crypto";
import { canonicalJsonBytes, type JsonValue } from "../protocol/canonical-json.js";

/** 返回协议值规范化 UTF-8 字节的小写 SHA-256 digest。 */
export function canonicalJsonDigest(value: JsonValue): string {
	return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}
