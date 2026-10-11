// One place for model IDs and fixed assumptions.
import type { ProviderId } from './lib/types.ts'

// Anthropic defaults. The settings screen lists what the user's key can use and lets them pick.
// OpenAI model ids are never hardcoded: they are listed from the API with the user's key.
export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster)' },
]

export const DEFAULT_MODEL: Record<ProviderId, string> = {
  anthropic: ANTHROPIC_MODELS[0].id,
  openai: '',
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
}

// Fixed demo rates into INR, not live rates. Each is shown wherever it is used.
// A currency with no rate here gets no price and a doubt.
export const FX_TO_INR: Record<string, number> = {
  INR: 1,
  USD: 88,
  EUR: 96,
}

// A cell is flagged when its price is more than this multiple of, or less than
// 1/this of, the line's median across vendors.
export const OUTLIER_FACTOR = 3

// A cell is flagged when its price is more than this share away from the buyer's
// reference price for the line (last year, last PO, current contract). Starting value from the
// plan. Widen it if the hand check shows it firing on correct prices.
export const OFF_REFERENCE_SHARE = 0.4

export const MAX_TOOL_CALLS = 6
