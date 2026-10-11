import type { ProviderId } from '../types.ts'
import { anthropic } from './anthropic.ts'
import { openai } from './openai.ts'
import type { Provider } from './types.ts'

export type { LoopMessage, Part, Provider, StepResult, ToolDef } from './types.ts'
export { PlainError } from './types.ts'

const PROVIDERS: Record<ProviderId, Provider> = { anthropic, openai }
export const getProvider = (id: ProviderId): Provider => PROVIDERS[id]

// What a model call needs: which provider, whose key, which model.
export interface Llm {
  provider: Provider
  key: string
  model: string
}

// One key slot per provider, in this browser's localStorage only.
const slot = (id: ProviderId) => `rfx.key.${id}`

export function loadKeys(): Record<ProviderId, string> {
  // v1 kept a single Anthropic key under rfx.apiKey. Move it into the Anthropic slot once.
  const old = localStorage.getItem('rfx.apiKey')
  if (old) {
    if (!localStorage.getItem(slot('anthropic'))) localStorage.setItem(slot('anthropic'), old)
    localStorage.removeItem('rfx.apiKey')
  }
  return { anthropic: localStorage.getItem(slot('anthropic')) ?? '', openai: localStorage.getItem(slot('openai')) ?? '' }
}
export const saveKey = (id: ProviderId, key: string) => localStorage.setItem(slot(id), key)
export const forgetKey = (id: ProviderId) => localStorage.removeItem(slot(id))

// Where the key goes for each provider, in plain words. Shown next to the key box.
export const KEY_COPY: Record<ProviderId, { label: string; placeholder: string; where: string }> = {
  anthropic: {
    label: 'Anthropic API key',
    placeholder: 'sk-ant-...',
    where: 'Stored in this browser only and sent straight to api.anthropic.com. No server behind this page sees it.',
  },
  openai: {
    label: 'OpenAI API key',
    placeholder: 'sk-...',
    where: 'Stored in this browser only and sent straight to api.openai.com. No server behind this page sees it.',
  },
}
