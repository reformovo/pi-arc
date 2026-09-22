import net from "node:net";

export interface NetworkSentinel {
	restore(): void;
}

export function installNetworkSentinel(): NetworkSentinel {
	const originalFetch = globalThis.fetch;
	const originalConnect = Object.getOwnPropertyDescriptor(net.Socket.prototype, "connect");
	globalThis.fetch = (): Promise<never> =>
		Promise.reject(new Error("external network disabled by pi-arc test sentinel"));
	Object.defineProperty(net.Socket.prototype, "connect", {
		configurable: true,
		value(): never {
			throw new Error("external network disabled by pi-arc test sentinel");
		},
	});
	return {
		restore() {
			globalThis.fetch = originalFetch;
			if (originalConnect === undefined) Reflect.deleteProperty(net.Socket.prototype, "connect");
			else Object.defineProperty(net.Socket.prototype, "connect", originalConnect);
		},
	};
}
