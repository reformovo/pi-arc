/** 验证 Pi 恢复消息只来自已提交 ARC Evidence 与知识投影。 */

import { describe, expect, it, vi } from "vitest";
import type { ArtifactStore, DomainRecord } from "../../src/adapters/artifact-store.js";
import type { ToolEvidencePort, ToolKnowledge } from "../../src/application/model-tools.js";
import { type ControllerPorts, RunController, type Turn } from "../../src/application/run-controller.js";
import { controllerPlayPort, recoverController } from "../../src/composition/controller-play.js";
import type { KnowledgeStore } from "../../src/composition/knowledge-store.js";
import { RuntimeKnowledgeBridge } from "../../src/composition/runtime-knowledge.js";

const observation = {
	state: "NOT_FINISHED" as const,
	levelsCompleted: 0,
	winLevels: 0,
	availableActions: ["ACTION1" as const],
};

function turn(number: number): Turn {
	return {
		turn: number,
		observation,
		observationDigest: `digest-${number}`,
		level: 1,
		attempt: 1,
		attemptStatus: "active",
		actionId: number === 0 ? null : `action-${number}`,
	};
}

function committed(number: number): DomainRecord {
	return {
		schema: "pi-arc.domain-record.v1",
		sequence: number + 1,
		recordedAt: "2026-09-24T00:00:00Z",
		recordType: "turn.commit",
		previousDigest: "0".repeat(64),
		digest: "1".repeat(64),
		payload: { ...turn(number) },
	};
}

function note(kind: "guide" | "working", content: string): ToolKnowledge {
	return { kind, content, version: 1, anchor: "turn-1", contentDigest: "digest", invocationId: "note" };
}

function bridgeFixture() {
	let checkpoint = false;
	let pending = false;
	let notesPresent = true;
	let boundary: {
		boundaryId: string;
		type: "reset";
		anchor: string;
		turn: number;
		guide: string;
		working: string;
		commitDigest: string;
	} | null = null;
	const acknowledgements: string[] = [];
	const artifacts = {
		readDomain: () => Promise.resolve([committed(0), committed(1)]),
	} as unknown as ArtifactStore;
	const knowledge = {
		read: (kind: "guide" | "working") =>
			Promise.resolve(notesPresent ? note(kind, kind === "guide" ? "game model" : "next move") : null),
		boundaryPending: () => Promise.resolve(pending),
		checkpointRequested: () => Promise.resolve(checkpoint),
		deliverBoundary: () => Promise.resolve(boundary),
		acknowledgeBoundary: (id: string) => {
			acknowledgements.push(id);
			pending = false;
			return Promise.resolve();
		},
	} as unknown as KnowledgeStore;
	return {
		bridge: new RuntimeKnowledgeBridge(artifacts, knowledge),
		setCheckpoint(value: boolean) {
			checkpoint = value;
		},
		setNotesPresent(value: boolean) {
			notesPresent = value;
		},
		setBoundary(value: boolean) {
			pending = value;
			boundary = value
				? {
						boundaryId: "reset-7",
						type: "reset",
						anchor: "turn-1",
						turn: 1,
						guide: "frozen guide",
						working: "frozen plan",
						commitDigest: "hash",
					}
				: null;
		},
		acknowledgements,
	};
}

describe("runtime knowledge bridge", () => {
	it("builds a settlement-lag envelope from Turn commits and durable notes", async () => {
		const fixture = bridgeFixture();
		const authority = { turn: turn(1), termination: null, finish: () => Promise.reject(new Error("unused")) };
		await fixture.bridge.validate(authority);
		const prompt = await fixture.bridge.recoveryEnvelope(authority);
		expect(prompt).toContain("game model");
		expect(prompt).toContain("next move");
		expect(prompt).toContain("action-1");
		expect(prompt).toContain("digest-1");
		expect(prompt).not.toContain("pi session");
	});

	it("keeps checkpoint requests and RESET boundary delivery distinct", async () => {
		const fixture = bridgeFixture();
		const authority = { turn: turn(1), termination: null, finish: () => Promise.reject(new Error("unused")) };
		fixture.setCheckpoint(true);
		expect(await fixture.bridge.pendingCheckpoint()).toBe(true);
		expect(await fixture.bridge.recoveryEnvelope(authority)).toContain("save_compact_checkpoint");
		fixture.setCheckpoint(false);
		fixture.setBoundary(true);
		const prepared = await fixture.bridge.prepareBoundary(authority);
		expect(prepared?.boundaryId).toBe("reset-7");
		expect(prepared?.prompt).toContain("frozen guide");
		expect(prepared?.prompt).toContain("frozen plan");
		expect(prepared?.prompt).not.toContain("game model");
		await fixture.bridge.acknowledgeBoundary("reset-7");
		expect(fixture.acknowledgements).toEqual(["reset-7"]);
		expect(await fixture.bridge.prepareBoundary(authority)).toBeNull();
	});

	it("uses empty notes and no last action for the initial Turn", async () => {
		const fixture = bridgeFixture();
		fixture.setNotesPresent(false);
		const authority = { turn: turn(0), termination: null, finish: () => Promise.reject(new Error("unused")) };
		const prompt = await fixture.bridge.recoveryEnvelope(authority);
		expect(prompt).toContain('"guide":""');
		expect(prompt).toContain('"working_memory":""');
		expect(prompt).toContain('"last_action_result":null');
		expect(await fixture.bridge.prepareBoundary(authority)).toBeNull();
	});
});

describe("controller play port", () => {
	it("delegates attach recovery to the authoritative RunController", async () => {
		const ports = {} as ControllerPorts;
		const recovered = {} as RunController;
		const spy = vi.spyOn(RunController, "recover").mockResolvedValue(recovered);
		try {
			expect(await recoverController("run-1", ports)()).toBe(recovered);
			expect(spy).toHaveBeenCalledWith("run-1", ports);
		} finally {
			spy.mockRestore();
		}
	});

	it("uses the Pi invocation as Action identity and returns only committed Turn and Visual", async () => {
		const requests: unknown[] = [];
		const controller = {
			play: (request: unknown) => {
				requests.push(request);
				return Promise.resolve(turn(1));
			},
		} as unknown as RunController;
		const evidence = {
			readFrame: (number: number, frame: number | null) => {
				expect([number, frame]).toEqual([1, null]);
				return Promise.resolve({
					turn: 1,
					frame: 2,
					visualRef: "visuals/t000001/f000002.png",
					visual: { width: 1, height: 1, rgb: Uint8Array.from([0, 0, 0]) },
				});
			},
		} as unknown as ToolEvidencePort;
		const port = controllerPlayPort(controller, evidence);
		const output = await port.play({
			invocationId: "pi-invocation",
			action: { name: "ACTION1", data: {} },
			retryState: null,
		});
		expect(requests).toEqual([
			{
				actionId: "pi-invocation",
				invocationId: "pi-invocation",
				action: { name: "ACTION1", data: {} },
			},
		]);
		expect(output.result.frameCount).toBe(3);
		expect(output.result.visualRef).toBe("visuals/t000001/f000002.png");
		await port.play({
			invocationId: "reset-invocation",
			action: { name: "RESET", data: {} },
			retryState: "new plan",
		});
		expect(requests[1]).toEqual({
			actionId: "reset-invocation",
			invocationId: "reset-invocation",
			action: { name: "RESET", data: {} },
			retryState: "new plan",
		});
	});
});
