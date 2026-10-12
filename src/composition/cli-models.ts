/** CLI 模型配置：只通过公开 Models/provider 边界覆盖 endpoint，不改写 request。 */
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

/** 静态 endpoint 配置错误；CLI 分类时不读取或输出配置原文。 */
export class InvalidCliModelConfiguration extends Error {
	constructor() {
		super("invalid OPENAI_BASE_URL");
	}
}

/** Configure only the endpoint selected by the user. Official DeepSeek endpoints use
 * the public DeepSeek provider; all other endpoints retain the historical OpenCode-Go
 * compatibility wrapper. */
export function createCliModels(
	env: { OPENAI_BASE_URL?: string | undefined; OPENAI_API_KEY?: string | undefined } = process.env,
) {
	const models = builtinModels();
	const baseUrl = env.OPENAI_BASE_URL?.trim();
	if (!baseUrl) return models;
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw new InvalidCliModelConfiguration();
	}
	if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
		throw new InvalidCliModelConfiguration();
	const direct = url.hostname.toLowerCase() === "api.deepseek.com";
	const providerId = direct ? "deepseek" : "opencode-go";
	const baselineId = direct ? "deepseek-flash" : "deepseek-v4.1-flash";
	const provider = models.getProvider(providerId);
	const baseline = models.getModel(providerId, baselineId);
	if (!provider || !baseline) throw new Error(`${providerId} model baseline unavailable`);
	const configured = provider
		.getModels()
		.map((model) =>
			model.api === "openai-completions" || model.api === "openai-responses" ? { ...model, baseUrl } : model,
		);
	if (!direct) configured.push({ ...baseline, id: "deepseek-flash", name: "DeepSeek Flash (VISTA)", baseUrl });
	const prior = provider.auth?.apiKey;
	models.setProvider({
		...provider,
		auth: {
			...provider.auth,
			apiKey: {
				...prior,
				name: "OpenAI API key",
				resolve: ({ signal }) => {
					signal.throwIfAborted();
					return Promise.resolve(
						env.OPENAI_API_KEY ? { auth: { apiKey: env.OPENAI_API_KEY }, source: "OPENAI_API_KEY" } : undefined,
					);
				},
			},
		},
		getModels: () => configured,
	});
	return models;
}
