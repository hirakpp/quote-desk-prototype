import { PlainError } from './types.ts'
import type { LoopMessage, Part, Provider, StepResult } from './types.ts'

// OpenAI adapter over the Responses API, called straight from the browser with the user's key.
// The key is sent to api.openai.com and nowhere else. Never log it, never put it in a URL.
// No model ids are hardcoded: listModels asks the API what this key can use.
const BASE = 'https://api.openai.com/v1'

class OpenAIError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function call(key: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new OpenAIError(0, 'network', 'Could not reach the OpenAI API.')
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const err = (json.error ?? {}) as { message?: string; code?: string; type?: string }
    throw new OpenAIError(res.status, err.code ?? err.type ?? '', err.message ?? `HTTP ${res.status}`)
  }
  return json
}

function content(parts: Part[], trailing?: string): unknown[] {
  const out: unknown[] = parts.map((p) => {
    if (p.kind === 'text') return { type: 'input_text', text: p.text }
    if (p.kind === 'image') return { type: 'input_image', image_url: `data:${p.mediaType};base64,${p.base64}` }
    return { type: 'input_file', filename: p.fileName, file_data: `data:application/pdf;base64,${p.base64}` }
  })
  if (trailing) out.push({ type: 'input_text', text: trailing })
  return out
}

interface OutItem {
  type: string
  content?: { type: string; text?: string; refusal?: string }[]
  call_id?: string
  name?: string
  arguments?: string
}

const outputText = (items: OutItem[]) =>
  items
    .filter((i) => i.type === 'message')
    .flatMap((i) => i.content ?? [])
    .filter((c) => c.type === 'output_text' && c.text)
    .map((c) => (c.text as string).trim())
    .filter(Boolean)
    .join('\n\n')

const refused = (items: OutItem[]) => items.some((i) => i.type === 'message' && (i.content ?? []).some((c) => c.type === 'refusal'))
const cutOff = (res: Record<string, unknown>) => res.status === 'incomplete' && (res.incomplete_details as { reason?: string } | undefined)?.reason === 'max_output_tokens'

function toInput(messages: LoopMessage[]): unknown[] {
  const input: unknown[] = []
  for (const m of messages) {
    if (m.kind === 'user') input.push({ role: 'user', content: m.text })
    else if (m.kind === 'assistant') input.push({ role: 'assistant', content: m.text })
    // The model's own output items (reasoning and function calls) go back unchanged.
    else if (m.kind === 'carry') input.push(...(m.carry as unknown[]))
    else for (const r of m.results) input.push({ type: 'function_call_output', call_id: r.id, output: r.content })
  }
  return input
}

// Models that are not text-in, text-out chat models.
const NOT_CHAT = /embedding|whisper|tts|audio|realtime|image|dall-e|moderation|transcribe|search|similarity|babbage|davinci|sora|computer-use|codex/i

export const openai: Provider = {
  id: 'openai',

  async listModels(key) {
    const res = await call(key, '/models')
    const data = (res.data ?? []) as { id: string; created?: number }[]
    return data
      .filter((m) => !NOT_CHAT.test(m.id))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      .map((m) => ({ id: m.id, label: m.id }))
  },

  async test(key, model) {
    const res = await call(key, '/responses', { model, store: false, input: 'Reply with one short sentence confirming you can read this.' })
    return outputText((res.output ?? []) as OutItem[])
  },

  async extract({ key, model, system, parts, instruction, schema }) {
    const res = await call(key, '/responses', {
      model,
      store: false,
      instructions: system,
      input: [{ role: 'user', content: content(parts, instruction) }],
      // Strict mode needs every property required and no extra properties. The extraction schema is written that way.
      text: { format: { type: 'json_schema', name: 'vendor_reply', strict: true, schema } },
    })
    const items = (res.output ?? []) as OutItem[]
    if (refused(items)) throw new PlainError('The model declined to read this document.')
    if (cutOff(res)) throw new PlainError('The document was too long to read in one pass. The output was cut off, so nothing was kept.')
    const text = outputText(items)
    if (!text) throw new PlainError('The model returned no readable result for this document.')
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new PlainError('The model returned a result that was not valid JSON. Try re-running this document.')
    }
  },

  async step({ key, model, system, tools, messages }): Promise<StepResult> {
    const res = await call(key, '/responses', {
      model,
      store: false,
      instructions: system,
      input: toInput(messages),
      // The analyst and co-pilot tools have optional parameters, so they are sent non-strict.
      tools: tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false })),
      // With store off, reasoning has to come back encrypted to be passed to the next round.
      include: ['reasoning.encrypted_content'],
    })
    const items = (res.output ?? []) as OutItem[]
    const calls = items.filter((i) => i.type === 'function_call')
    const toolUses = calls.map((c) => {
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(c.arguments || '{}') as Record<string, unknown>
      } catch {
        input = {}
      }
      return { id: c.call_id as string, name: c.name as string, input }
    })
    return {
      text: outputText(items),
      toolUses,
      stop: refused(items) ? 'refusal' : cutOff(res) ? 'max_tokens' : toolUses.length ? 'tool_use' : 'end',
      carry: items,
    }
  },

  explainError(e) {
    if (e instanceof PlainError) return e.message
    if (e instanceof OpenAIError) {
      if (e.status === 0) return 'Could not reach the OpenAI API. Check your network. If it keeps failing only in the browser, OpenAI may be blocking browser calls for this key.'
      if (e.status === 401) return 'That OpenAI API key was rejected. Check it and paste it again.'
      if (e.code === 'insufficient_quota') return 'This OpenAI key is out of credit. Add credit in the OpenAI dashboard or use another key.'
      if (e.status === 429) return 'Rate limit reached for this key. Wait a minute and try again.'
      if (e.status === 403 || e.code === 'model_not_found' || e.status === 404) return 'This key cannot use this model. Pick another model in settings, or use a different key.'
      if (e.status === 400 && /file|image|pdf|vision|modal/i.test(e.message)) return `This model could not take this kind of file. Pick another model in settings. (OpenAI said: ${e.message})`
      return `OpenAI rejected the request (${e.status}): ${e.message}`
    }
    if (e instanceof Error) return e.message
    return String(e)
  },
}
