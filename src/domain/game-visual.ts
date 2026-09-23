/**
 * ARC Raw Frame 到模型 Visual 的纯领域规则。
 *
 * 本模块固定 1024×1024 坐标、ACTION6 映射、ARC 16 色和最近邻视觉语义；
 * 它不读取文件、不编码 PNG，也不决定某个 Frame 是否属于权威 Observation。
 */

export const DISPLAY_SIZE = 1024;
export const ENVIRONMENT_GRID_SIZE = 64;
export const MAX_RAW_FRAME_SIZE = 64;
export const MAX_PIXEL_SAMPLES = 4096;

/** 一个不透明度固定为 255 的 RGB 颜色。 */
export type Rgb = readonly [red: number, green: number, blue: number];

/** arc-agi 0.9.9 使用的固定 16 色 RGB palette。 */
export const ARC_PALETTE: readonly Rgb[] = [
	[255, 255, 255],
	[204, 204, 204],
	[153, 153, 153],
	[102, 102, 102],
	[51, 51, 51],
	[0, 0, 0],
	[229, 58, 163],
	[255, 123, 204],
	[249, 60, 49],
	[30, 147, 255],
	[136, 216, 241],
	[255, 220, 0],
	[255, 133, 27],
	[146, 18, 49],
	[79, 204, 48],
	[163, 86, 214],
];

/** 已完成形状、整数和 palette 校验的原始 ARC Frame。 */
export interface NormalizedRawFrame {
	width: number;
	height: number;
	pixels: number[][];
}

/** RGB 字节按 row-major 顺序连续存放的确定性 Visual。 */
export interface Visual {
	width: number;
	height: number;
	rgb: Uint8Array;
}

/** 使用 1024×1024 Visual 坐标表达且不越界的矩形区域。 */
export interface VisualRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Raw Frame 违反 ARC 尺寸、矩形或 palette 约束。 */
export class RawFrameValidationError extends Error {
	readonly code = "invalid_raw_frame";
}

/** Visual 坐标、区域或采样维度无效。 */
export class VisualValidationError extends Error {
	readonly code = "invalid_visual";
}

function isInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value);
}

function assertVisual(visual: Visual): void {
	if (
		!isInteger(visual.width) ||
		!isInteger(visual.height) ||
		visual.width < 1 ||
		visual.height < 1 ||
		visual.rgb.length !== visual.width * visual.height * 3
	) {
		throw new VisualValidationError("Visual dimensions do not match its RGB bytes");
	}
}

function channelAt(bytes: Uint8Array, index: number): number {
	const value = bytes[index];
	if (value === undefined) throw new VisualValidationError("Visual RGB index is outside the image");
	return value;
}

/**
 * 校验并复制一个 1..64 的非空矩形整数网格。
 *
 * 返回副本可防止 Environment 在校验后修改原数组，从而让 digest 与 Visual
 * 对应不同内容。
 */
export function normalizeRawFrame(value: unknown): NormalizedRawFrame {
	if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RAW_FRAME_SIZE) {
		throw new RawFrameValidationError("Raw Frame height must be in 1..64");
	}
	let width: number | undefined;
	const pixels: number[][] = [];
	for (const candidate of value) {
		if (!Array.isArray(candidate) || candidate.length < 1 || candidate.length > MAX_RAW_FRAME_SIZE) {
			throw new RawFrameValidationError("Raw Frame width must be in 1..64");
		}
		if (width !== undefined && candidate.length !== width) {
			throw new RawFrameValidationError("Raw Frame rows must have equal width");
		}
		width = candidate.length;
		const row: number[] = [];
		for (const pixel of candidate) {
			if (!isInteger(pixel) || pixel < 0 || pixel >= ARC_PALETTE.length) {
				throw new RawFrameValidationError("Raw Frame colors must be integers in 0..15");
			}
			row.push(pixel);
		}
		pixels.push(row);
	}
	if (width === undefined) throw new RawFrameValidationError("Raw Frame has no rows");
	return { width, height: pixels.length, pixels };
}

/** 将一个合法 1024 显示坐标映射到 ACTION6 的 0..63 环境坐标。 */
export function mapAction6Coordinate(coordinate: number): number {
	if (!Number.isSafeInteger(coordinate) || coordinate < 0 || coordinate >= DISPLAY_SIZE) {
		throw new VisualValidationError("ACTION6 coordinate must be an integer in 0..1023");
	}
	return Math.floor((coordinate * ENVIRONMENT_GRID_SIZE) / DISPLAY_SIZE);
}

/** 将 ACTION6 的显示坐标点映射为 sidecar 接收的环境网格点。 */
export function mapAction6Point(x: number, y: number): Readonly<{ x: number; y: number }> {
	return { x: mapAction6Coordinate(x), y: mapAction6Coordinate(y) };
}

/**
 * 以无平滑最近邻方式把 Raw Frame 拉伸为固定 1024×1024 Visual。
 * 每个输出像素只复制一个原始 palette 颜色，绝不插值产生新颜色。
 */
export function renderVisual(value: unknown): Visual {
	const frame = normalizeRawFrame(value);
	const rgb = new Uint8Array(DISPLAY_SIZE * DISPLAY_SIZE * 3);
	for (let targetY = 0; targetY < DISPLAY_SIZE; targetY += 1) {
		const sourceY = Math.floor((targetY * frame.height) / DISPLAY_SIZE);
		const row = frame.pixels[sourceY];
		if (row === undefined) throw new RawFrameValidationError("Raw Frame row is missing");
		for (let targetX = 0; targetX < DISPLAY_SIZE; targetX += 1) {
			const sourceX = Math.floor((targetX * frame.width) / DISPLAY_SIZE);
			const colorIndex = row[sourceX];
			const color = colorIndex === undefined ? undefined : ARC_PALETTE[colorIndex];
			if (color === undefined) throw new RawFrameValidationError("Raw Frame color is missing from the palette");
			const offset = (targetY * DISPLAY_SIZE + targetX) * 3;
			rgb[offset] = color[0];
			rgb[offset + 1] = color[1];
			rgb[offset + 2] = color[2];
		}
	}
	return { width: DISPLAY_SIZE, height: DISPLAY_SIZE, rgb };
}

/** 返回 Visual 中一个精确坐标的 RGB，不执行缩放或近似采样。 */
export function readVisualPixel(visual: Visual, x: number, y: number): Rgb {
	assertVisual(visual);
	if (!isInteger(x) || !isInteger(y) || x < 0 || y < 0 || x >= visual.width || y >= visual.height) {
		throw new VisualValidationError("Visual coordinate is outside the image");
	}
	const offset = (y * visual.width + x) * 3;
	return [channelAt(visual.rgb, offset), channelAt(visual.rgb, offset + 1), channelAt(visual.rgb, offset + 2)];
}

/** 严格校验 region 字段及 1024×1024 边界，不裁剪越界输入。 */
export function validateVisualRegion(value: unknown): VisualRegion {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new VisualValidationError("Visual region must be an object");
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	if (keys.join(",") !== "height,width,x,y") {
		throw new VisualValidationError("Visual region has unknown or missing fields");
	}
	const { x, y, width, height } = record;
	if (!isInteger(x) || !isInteger(y) || !isInteger(width) || !isInteger(height)) {
		throw new VisualValidationError("Visual region fields must be integers");
	}
	if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > DISPLAY_SIZE || y + height > DISPLAY_SIZE) {
		throw new VisualValidationError("Visual region is outside 1024x1024");
	}
	return { x, y, width, height };
}

/**
 * 精确裁剪 region，并按最长边 1024 等比例最近邻放大。
 * 输出不补边，因此另一条边可以小于 1024，与 inspect 的 image content 一致。
 */
export function renderInspectionRegion(visual: Visual, regionValue: unknown): Visual {
	assertVisual(visual);
	if (visual.width !== DISPLAY_SIZE || visual.height !== DISPLAY_SIZE) {
		throw new VisualValidationError("Inspection source must be a 1024x1024 Visual");
	}
	const region = validateVisualRegion(regionValue);
	const longestSide = Math.max(region.width, region.height);
	const width = Math.floor((region.width * DISPLAY_SIZE) / longestSide);
	const height = Math.floor((region.height * DISPLAY_SIZE) / longestSide);
	const rgb = new Uint8Array(width * height * 3);
	for (let targetY = 0; targetY < height; targetY += 1) {
		const sourceY = region.y + Math.floor((targetY * region.height) / height);
		for (let targetX = 0; targetX < width; targetX += 1) {
			const sourceX = region.x + Math.floor((targetX * region.width) / width);
			const color = readVisualPixel(visual, sourceX, sourceY);
			const offset = (targetY * width + targetX) * 3;
			rgb[offset] = color[0];
			rgb[offset + 1] = color[1];
			rgb[offset + 2] = color[2];
		}
	}
	return { width, height, rgb };
}

/**
 * 把 region 等分为 rows×columns，并读取每个 bin 的确定性中心像素。
 * 公式与 VISTA 行为证据一致；本函数不做颜色解释或相邻像素推断。
 */
export function sampleVisualRegion(
	visual: Visual,
	regionValue: unknown,
	rows: number,
	columns: number,
): readonly (readonly Rgb[])[] {
	assertVisual(visual);
	if (visual.width !== DISPLAY_SIZE || visual.height !== DISPLAY_SIZE) {
		throw new VisualValidationError("Pixel sampling source must be a 1024x1024 Visual");
	}
	const region = validateVisualRegion(regionValue);
	if (
		!isInteger(rows) ||
		!isInteger(columns) ||
		rows < 1 ||
		columns < 1 ||
		rows > DISPLAY_SIZE ||
		columns > DISPLAY_SIZE ||
		rows * columns > MAX_PIXEL_SAMPLES
	) {
		throw new VisualValidationError("Pixel sample dimensions exceed the v1 limits");
	}
	const sampleX = Array.from(
		{ length: columns },
		(_, column) => region.x + Math.floor(((2 * column + 1) * region.width) / (2 * columns)),
	);
	const sampleY = Array.from(
		{ length: rows },
		(_, row) => region.y + Math.floor(((2 * row + 1) * region.height) / (2 * rows)),
	);
	return sampleY.map((sampleRow) => sampleX.map((sampleColumn) => readVisualPixel(visual, sampleColumn, sampleRow)));
}
