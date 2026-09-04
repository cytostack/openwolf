// Cost estimation for measured token usage.
//
// OpenWolf never sees a bill. What it has is exact per-model token counts read
// from the harness transcript, so it can report what that usage is worth at
// Anthropic's published list price. That is a different claim from "you were
// charged this", and the UI says so: most Claude Code users are on a
// subscription and pay nothing per token. The number answers "what did this
// project's token usage cost to produce", which is the question that makes
// cache economics legible to someone who does not read ledgers.

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  api_calls: number;
}

export interface ModelPrice {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

// Anthropic list prices, USD per million tokens. Longest-prefix match, so a
// dated snapshot id resolves to its family. Anything unknown falls through to
// UNKNOWN_PRICE and is reported separately rather than silently priced wrong.
const PRICES: Array<[prefix: string, price: ModelPrice]> = [
  ["claude-fable-5", { input: 10, output: 50 }],
  ["claude-mythos-5", { input: 10, output: 50 }],
  ["claude-opus-5", { input: 5, output: 25 }],
  ["claude-opus-4-8", { input: 5, output: 25 }],
  ["claude-opus-4-7", { input: 5, output: 25 }],
  ["claude-opus-4-6", { input: 5, output: 25 }],
  ["claude-sonnet-5", { input: 3, output: 15 }],
  ["claude-sonnet-4-6", { input: 3, output: 15 }],
  ["claude-haiku-4-5", { input: 1, output: 5 }],
];

/** Cache reads bill at ~0.1x the model's input rate. */
export const CACHE_READ_MULTIPLIER = 0.1;
/** Writing to the 5-minute ephemeral cache bills at ~1.25x the input rate. */
export const CACHE_WRITE_MULTIPLIER = 1.25;

export function priceFor(model: string): ModelPrice | null {
  const id = model.toLowerCase();
  let best: ModelPrice | null = null;
  let bestLen = -1;
  for (const [prefix, price] of PRICES) {
    if (id.startsWith(prefix) && prefix.length > bestLen) {
      best = price;
      bestLen = prefix.length;
    }
  }
  return best;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

const ZERO: CostBreakdown = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

export function costOf(usage: ModelUsage, price: ModelPrice): CostBreakdown {
  const input = ((usage.input_tokens ?? 0) * price.input) / 1_000_000;
  const output = ((usage.output_tokens ?? 0) * price.output) / 1_000_000;
  const cacheRead = ((usage.cache_read_input_tokens ?? 0) * price.input * CACHE_READ_MULTIPLIER) / 1_000_000;
  const cacheWrite = ((usage.cache_creation_input_tokens ?? 0) * price.input * CACHE_WRITE_MULTIPLIER) / 1_000_000;
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

export interface ProjectCost extends CostBreakdown {
  /** Per-model rows, most expensive first. Unpriced models are excluded. */
  byModel: Array<{ model: string; usage: ModelUsage; cost: CostBreakdown }>;
  /** Models with usage but no known price. Their tokens are NOT in the total. */
  unpriced: string[];
  /** True when at least one model was priced, i.e. the total means something. */
  priced: boolean;
}

/**
 * Price a whole project from its per-model usage map.
 *
 * `<synthetic>` and any other non-model key are skipped: synthetic entries are
 * transcript bookkeeping with zero token counts, not billable calls.
 */
export function costOfProject(perModel: Record<string, ModelUsage> | undefined): ProjectCost {
  const rows: ProjectCost["byModel"] = [];
  const unpriced: string[] = [];
  const acc: CostBreakdown = { ...ZERO };

  for (const [model, usage] of Object.entries(perModel ?? {})) {
    if (!usage) continue;
    const tokens =
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    if (tokens === 0) continue;
    const price = priceFor(model);
    if (!price) {
      unpriced.push(model);
      continue;
    }
    const cost = costOf(usage, price);
    rows.push({ model, usage, cost });
    acc.input += cost.input;
    acc.output += cost.output;
    acc.cacheRead += cost.cacheRead;
    acc.cacheWrite += cost.cacheWrite;
    acc.total += cost.total;
  }

  rows.sort((a, b) => b.cost.total - a.cost.total);
  return { ...acc, byModel: rows, unpriced, priced: rows.length > 0 };
}

/** "$84.12", "$1.20", "$0.04", "<$0.01" — never scientific notation. */
export function formatUsd(amount: number): string {
  if (!isFinite(amount) || amount <= 0) return "$0.00";
  if (amount < 0.01) return "<$0.01";
  if (amount >= 1000) return `$${Math.round(amount).toLocaleString("en-US")}`;
  return `$${amount.toFixed(2)}`;
}
