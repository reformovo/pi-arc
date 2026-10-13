/** history 与恢复共用的只读证据关联；权威 native 坐标不改写，只投影模型可见动作。 */
import { canonicalJson, type JsonValue } from "../protocol/canonical-json.js";
import type { ToolDomainRecord } from "./model-tools.js";

export function committedActionProjection(records: readonly ToolDomainRecord[]) {
	const intents = new Map<JsonValue | undefined, ToolDomainRecord[]>();
	const receipts = new Map<JsonValue | undefined, ToolDomainRecord[]>();
	const commits = new Map<JsonValue | undefined, ToolDomainRecord[]>();
	for (const record of records) {
		const index =
			record.recordType === "action.intent"
				? intents
				: record.recordType === "environment.receipt"
					? receipts
					: record.recordType === "turn.commit"
						? commits
						: null;
		if (index === null) continue;
		const key = index === commits ? record.payload.turn : record.payload.actionId;
		const entries = index.get(key) ?? [];
		entries.push(record);
		index.set(key, entries);
	}
	return (commit: ToolDomainRecord): JsonValue => {
		if (commit.payload.actionId === null && commit.payload.turn === 0) return null;
		const matchingIntents =
			intents.get(commit.payload.actionId)?.filter((record) => record.sequence < commit.sequence) ?? [];
		const intent = matchingIntents[0];
		if (
			!intent ||
			matchingIntents.length !== 1 ||
			typeof commit.payload.actionId !== "string" ||
			typeof commit.payload.receiptDigest !== "string" ||
			intent.payload.action === null ||
			typeof intent.payload.action !== "object" ||
			Array.isArray(intent.payload.action)
		)
			throw new Error("recovery Action intent or receipt digest missing for committed Turn");
		const matchingReceipts =
			receipts
				.get(commit.payload.actionId)
				?.filter(
					(record) =>
						record.sequence > intent.sequence &&
						record.sequence < commit.sequence &&
						record.payload.receiptDigest === commit.payload.receiptDigest,
				) ?? [];
		const receipt = matchingReceipts[0];
		const baseTurn = intent.payload.baseTurn;
		const baseCommits = commits.get(baseTurn)?.filter((record) => record.sequence < intent.sequence) ?? [];
		if (
			typeof intent.payload.environmentInstanceId !== "string" ||
			intent.payload.environmentInstanceId.length === 0 ||
			typeof baseTurn !== "number" ||
			!Number.isSafeInteger(baseTurn) ||
			baseTurn < 0 ||
			typeof intent.payload.baseObservationDigest !== "string" ||
			baseCommits.length !== 1 ||
			baseCommits[0]?.payload.observationDigest !== intent.payload.baseObservationDigest ||
			commit.payload.turn !== baseTurn + 1
		)
			throw new Error("recovery Action base anchor missing or invalid");
		if (
			!receipt ||
			matchingReceipts.length !== 1 ||
			receipt.payload.status !== "complete" ||
			receipt.payload.environmentInstanceId !== intent.payload.environmentInstanceId ||
			receipt.payload.baseTurn !== intent.payload.baseTurn ||
			receipt.payload.baseObservationDigest !== intent.payload.baseObservationDigest ||
			receipt.payload.turn !== commit.payload.turn ||
			canonicalJson(receipt.payload.action ?? null) !== canonicalJson(intent.payload.action) ||
			canonicalJson(receipt.payload.observation ?? null) !== canonicalJson(commit.payload.observation ?? null)
		)
			throw new Error("recovery Action/receipt/Turn commit mismatch");
		const action = intent.payload.action;
		if (typeof action.name !== "string" || !/^(RESET|ACTION[1-7])$/.test(action.name))
			throw new Error("recovery Action name invalid");
		if (action.name !== "ACTION6") return { name: action.name, data: {} };
		const data = action.data;
		if (data === null || typeof data !== "object" || Array.isArray(data))
			throw new Error("recovery ACTION6 native coordinates invalid");
		const { x, y } = data;
		if (
			typeof x !== "number" ||
			typeof y !== "number" ||
			!Number.isInteger(x) ||
			!Number.isInteger(y) ||
			x < 0 ||
			y < 0 ||
			x > 63 ||
			y > 63
		)
			throw new Error("recovery ACTION6 native coordinates invalid");
		return {
			name: "ACTION6",
			data: { x: x * 16 + 8, y: y * 16 + 8 },
			coordinateSpace: "visual_1024",
			coordinateRepresentation: "canonical_replay_equivalent",
		};
	};
}
