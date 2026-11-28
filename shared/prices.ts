// Token counts of one turn. input excludes cachedInput (Codex reports input_tokens with the cached part inside, so
// its recorder subtracts it). reasoning is already inside output on both providers (Codex reasoning_output_tokens is
// part of output_tokens), so it is shown but never billed again.
export type TurnTokens = { model: string; input: number; cachedInput: number; cacheWrite: number; output: number; reasoning: number };

export type Price = { input: number; cachedInput: number; cacheWrite: number; output: number };

const p = (input: number, cachedInput: number, cacheWrite: number, output: number): Price => ({ input, cachedInput, cacheWrite, output });

// $ per million tokens, keyed by model id prefix; the longest matching prefix wins. Cache write is Anthropic's
// 5-minute rate and OpenAI's 30-minute rate. Checked against both price pages on 2026-11-28.
export const PRICES: Record<string, Price> = {
  'claude-fable-5-2': p(8, 0.2, 10, 40),
  'claude-fable-5': p(10, 1, 12.5, 50),
  'claude-mythos-5-2': p(8, 0.2, 10, 40),
  'claude-mythos-5': p(10, 1, 12.5, 50),
  'claude-opus-5-5': p(4, 0.2, 5, 20),
  'claude-opus-5': p(5, 0.5, 6.25, 25),
  'claude-opus-4-5': p(5, 0.5, 6.25, 25),
  'claude-opus-4-6': p(5, 0.5, 6.25, 25),
  'claude-opus-4-7': p(5, 0.5, 6.25, 25),
  'claude-opus-4-8': p(5, 0.5, 6.25, 25),
  'claude-opus-4': p(15, 1.5, 18.75, 75),
  'claude-sonnet-5-5': p(2, 0.1, 2.5, 10),
  'claude-sonnet-5': p(2, 0.2, 2.5, 10),
  'claude-sonnet-4': p(3, 0.3, 3.75, 15),
  'claude-haiku-5-5': p(0.1, 0.01, 0.125, 0.5),
  'claude-haiku-4-5': p(1, 0.1, 1.25, 5),
  'gpt-6.2-astra': p(8, 0.4, 10, 40),
  'gpt-6.2-sol': p(2, 0.1, 2.5, 10),
  'gpt-6.1-sol': p(2, 0.1, 2.5, 10),
  'gpt-6.1-terra': p(1, 0.05, 1.25, 5),
  'gpt-6-astra': p(10, 1, 12.5, 50),
  'gpt-6-sol': p(2, 0.2, 2.5, 10),
  'gpt-6-luna': p(0.1, 0.01, 0.125, 0.5),
  'gpt-5.6-sol': p(4, 0.4, 5, 20),
  'gpt-5.6-terra': p(2, 0.2, 2.5, 12),
  'gpt-5.6-luna': p(0.2, 0.02, 0.25, 1.2),
  'gpt-5.5': p(5, 0.5, 0, 30),
  'gpt-5.4-mini': p(0.75, 0.075, 0, 4.5),
  'gpt-5.4': p(2.5, 0.25, 0, 15),
  'gpt-5.2': p(1.75, 0.175, 0, 14),
  'gpt-5.1': p(1.25, 0.125, 0, 10),
  'gpt-5-mini': p(0.25, 0.025, 0, 2),
  'gpt-5': p(1.25, 0.125, 0, 10),
  o3: p(2, 0.5, 0, 8),
};

export function priceOf(model: string): Price | null {
  const id = model.toLowerCase();
  let best: string | null = null;
  for (const k of Object.keys(PRICES)) if (id.startsWith(k) && (!best || k.length > best.length)) best = k;
  return best ? PRICES[best] : null;
}

// Dollars for one turn, or null when the model has no price.
export function costOf(t: TurnTokens): number | null {
  const pr = priceOf(t.model);
  if (!pr) return null;
  return (t.input * pr.input + t.cachedInput * pr.cachedInput + t.cacheWrite * pr.cacheWrite + t.output * pr.output) / 1e6;
}
