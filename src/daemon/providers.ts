/**
 * Inference provider registry for the cron AI task runner.
 *
 * The scheduled `ai_task` jobs drive the `claude` CLI, which speaks the
 * Anthropic-compatible wire protocol. By default the runner relies on the CLI's
 * OAuth subscription credentials. When a provider is selected in
 * `.wolf/config.json` (`openwolf.cron.provider`), the runner instead points the
 * CLI at that provider's Anthropic-compatible base URL and requests one of its
 * models, so alternative backends can serve the scheduled tasks.
 *
 * Each provider ships the models it exposes and its regional endpoints, so a
 * task can be pinned to a specific region without hard-coding a URL in config.
 */

export interface ProviderEndpoint {
  /** Stable region key referenced by config (e.g. "global_en", "cn_zh"). */
  region: string;
  /** Anthropic-compatible base URL consumed by the `claude` CLI. */
  anthropicBaseUrl: string;
  /** OpenAI-compatible base URL for direct HTTP clients. */
  openaiBaseUrl: string;
}

export interface ProviderPricingUsdPerMillionTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number | null;
}

export type ProviderInputModality = "text" | "image" | "video";
export type ProviderThinkingMode = "adaptive" | "disabled" | "always_on";

export interface ProviderModel {
  id: string;
  /** Maximum combined input + output tokens the model accepts. */
  contextWindow: number;
  pricingUsdPerMillionTokens: ProviderPricingUsdPerMillionTokens;
  inputModalities: ProviderInputModality[];
  thinking: ProviderThinkingMode[];
}

export interface InferenceProvider {
  /** Human-readable provider name. */
  name: string;
  /** Environment variable that holds the provider API key. */
  apiKeyEnv: string;
  /** Model requested when a task does not name one. */
  defaultModel: string;
  models: ProviderModel[];
  endpoints: ProviderEndpoint[];
}

/** Region used when a provider is selected without naming one. */
export const DEFAULT_REGION = "global_en";

export const PROVIDERS: Record<string, InferenceProvider> = {
  minimax: {
    name: "MiniMax",
    apiKeyEnv: "MINIMAX_API_KEY",
    defaultModel: "MiniMax-M3",
    models: [
      {
        id: "MiniMax-M3",
        contextWindow: 1_000_000,
        pricingUsdPerMillionTokens: {
          input: 0.6,
          output: 2.4,
          cacheRead: 0.12,
          cacheWrite: null,
        },
        inputModalities: ["text", "image", "video"],
        thinking: ["adaptive", "disabled"],
      },
      {
        id: "MiniMax-M2.7",
        contextWindow: 204_800,
        pricingUsdPerMillionTokens: {
          input: 0.3,
          output: 1.2,
          cacheRead: 0.06,
          cacheWrite: 0.375,
        },
        inputModalities: ["text"],
        thinking: ["always_on"],
      },
    ],
    endpoints: [
      {
        region: "global_en",
        anthropicBaseUrl: "https://api.minimax.io/anthropic",
        openaiBaseUrl: "https://api.minimax.io/v1",
      },
      {
        region: "cn_zh",
        anthropicBaseUrl: "https://api.minimaxi.com/anthropic",
        openaiBaseUrl: "https://api.minimaxi.com/v1",
      },
    ],
  },
};

/** Selection block stored under `openwolf.cron.provider` in config.json. */
export interface ProviderConfig {
  /** Provider registry key (e.g. "minimax"). */
  id?: string;
  /** Endpoint region key; falls back to DEFAULT_REGION. */
  region?: string;
  /** Model id to request; falls back to the provider's default model. */
  model?: string;
}

export interface ResolvedProvider {
  provider: InferenceProvider;
  endpoint: ProviderEndpoint;
  model: string;
}

export function getProvider(id: string): InferenceProvider | undefined {
  return PROVIDERS[id.trim().toLowerCase()];
}

export function getEndpoint(
  provider: InferenceProvider,
  region: string
): ProviderEndpoint | undefined {
  return provider.endpoints.find((e) => e.region === region);
}

/**
 * Resolve a `provider` config block into a concrete provider, endpoint, and
 * model. Returns `null` when no provider is selected (the runner then keeps its
 * default subscription behavior). Throws when the provider, region, or model is
 * named but unknown, so a misconfigured task fails loudly instead of silently
 * running against the wrong backend.
 */
export function resolveProviderConfig(
  config: ProviderConfig | undefined | null
): ResolvedProvider | null {
  if (!config || !config.id) return null;

  const provider = getProvider(config.id);
  if (!provider) {
    const known = Object.keys(PROVIDERS).join(", ");
    throw new Error(`Unknown inference provider "${config.id}" (known: ${known})`);
  }

  const region = config.region ?? DEFAULT_REGION;
  const endpoint = getEndpoint(provider, region);
  if (!endpoint) {
    const known = provider.endpoints.map((e) => e.region).join(", ");
    throw new Error(
      `Unknown region "${region}" for provider ${provider.name} (known: ${known})`
    );
  }

  const model = config.model ?? provider.defaultModel;
  if (!provider.models.some((m) => m.id === model)) {
    const known = provider.models.map((m) => m.id).join(", ");
    throw new Error(
      `Unknown model "${model}" for provider ${provider.name} (known: ${known})`
    );
  }

  return { provider, endpoint, model };
}
