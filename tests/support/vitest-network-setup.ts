import { afterAll } from "vitest";
import { installNetworkSentinel } from "./network-sentinel.js";

const sentinel = installNetworkSentinel();

afterAll(() => {
	sentinel.restore();
});
