/** pi-arc v1 SDK 根导出；不暴露 Pi session/lane 或直接工具驱动。 */

import type { Models } from "@earendil-works/pi-ai";
import { createHostWithPorts, type PiArcHost } from "./pi-arc-host.js";

export type {
	AuditResult,
	PiArcHost,
	ResumeRequest,
	RunInvocationResult,
	RunRequest,
	RunResult,
} from "./pi-arc-host.js";
export type { RunEvent } from "./run-events.js";

/** Models 必须由调用者预先配置凭据；SDK 不接收 raw API key。 */
export function createPiArcHost(models: Models): PiArcHost {
	return createHostWithPorts(models);
}
