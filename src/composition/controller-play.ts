/**
 * 将模型 play 的稳定 Pi invocation identity 绑定到 ARC Action 三段协议。
 *
 * Action 完成取决于 controller Turn commit；Pi tool result 只负责把已提交
 * Observation 和最后一帧 Visual 交回模型，不能反过来证明 Environment 完成。
 */

import { ModelToolError, type ToolEvidencePort, type ToolPlayPort } from "../application/model-tools.js";
import { ActionRejectedError, type ControllerPorts, RunController } from "../application/run-controller.js";

/** WP-09 组装时直接注入此闭包，确保 Pi attach 使用 WP-06 的同实例 reconciliation。 */
export function recoverController(runId: string, ports: ControllerPorts): () => Promise<RunController> {
	return () => RunController.recover(runId, ports);
}

/** Pi invocationId 在 session 中唯一，可直接作为同一 Run 的稳定 actionId。 */
export function controllerPlayPort(controller: RunController, evidence: ToolEvidencePort): ToolPlayPort {
	return {
		play: async ({ invocationId, action, retryState }) => {
			const turn = await controller
				.play({
					actionId: invocationId,
					invocationId,
					action,
					...(retryState === null ? {} : { retryState }),
				})
				.catch((error: unknown) => {
					// admission 拒绝是可修正的工具输入错误，不是存储故障。
					// 仅映射 controller 的显式拒绝；commit/storage 异常仍原样传播。
					if (error instanceof ActionRejectedError) throw new ModelToolError("invalid_request", error.message);
					throw error;
				});
			const last = await evidence.readFrame(turn.turn, null);
			return {
				result: {
					turn: turn.turn,
					attempt: turn.attempt,
					level: turn.level,
					state: turn.observation.state,
					levelsCompleted: turn.observation.levelsCompleted,
					winLevels: turn.observation.winLevels,
					availableActions: turn.observation.availableActions,
					frameCount: last.frame + 1,
					visualRef: last.visualRef,
					observationDigest: turn.observationDigest,
				},
				image: last.visual,
			};
		},
	};
}
