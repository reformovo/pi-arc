import { deflateSync } from "node:zlib";

/** Deterministic, synthetic RGB raster only; no game/assets or external input.
 * @param {number} variant
 */
export function syntheticPng1024(variant) {
	const size = 1024;
	const raw = Buffer.alloc(size * (1 + size * 3));
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const offset = y * (1 + size * 3) + 1 + x * 3;
			raw[offset] = (x + variant * 73) & 255;
			raw[offset + 1] = (y + variant * 41) & 255;
			raw[offset + 2] = ((x ^ y) + variant * 29) & 255;
		}
	}
	/** @param {string} type @param {Buffer} data */
	const chunk = (type, data) => {
		const tagged = Buffer.concat([Buffer.from(type), data]);
		let crc = 0xffffffff;
		for (const byte of tagged) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const checksum = Buffer.alloc(4);
		checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
		return Buffer.concat([length, tagged, checksum]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	return Buffer.concat([
		Buffer.from("89504e470d0a1a0a", "hex"),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]).toString("base64");
}
