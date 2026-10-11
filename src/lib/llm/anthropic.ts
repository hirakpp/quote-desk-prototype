import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODELS } from '../../config.ts'
import { PlainError } from './types.ts'
import type { LoopMessage, Part, Provider } from './types.ts'

// The key is sent to api.anthropic.com and nowhere else. Never log it, never put it in a URL.
function client(key: string): Anthropic {
  // dangerouslyAllowBrowser is the SDK's explicit opt-in for direct browser calls.
  // It is acceptable here only because each user brings their own key.
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 })
}

function blocks(parts: Part[]): Anthropic.ContentBlockParam[] {
  return parts.map((p): Anthropic.ContentBlockParam => {
    if (p.kind === 'text') return { type: 'text', text: p.text }
    if (p.kind === 'image') return { type: 'image', source: { type: 'base64', media_type: p.mediaType as 'image/jpeg' | 'image/png', data: p.base64 } }
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } }
  })
}

function toMessages(messages: LoopMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.kind === 'user') return { role: 'user', content: m.text }
    if (m.kind === 'assistant') return { role: 'assistant', content: m.text }
    if (m.kind === 'carry') return { role: 'assistant', content: m.carry as Anthropic.ContentBlockParam[] }
    return {
      role: 'user',
      content: m.results.map((r): Anthropic.ToolResultBlockParam => ({ type: 'tool_result', tool_use_id: r.id, is_error: r.isError, content: r.content })),
    }
  })
}

export const anthropic: Provider = {
  id: 'anthropic',

  async listModels(key) {
    const out: { id: string; label: string }[] = []
    for await (const m of client(key).models.list()) out.push({ id: m.id, label: m.display_name || m.id })
    // The two defaults go first when the key can use them.
    const first = ANTHROPIC_MODELS.map((d) => out.find((m) => m.id === d.id)).filter((m): m is { id: string; label: string } => !!m)
    return [...first, ...out.filter((m) => !first.includes(m))]
  },

  async test(key, model) {
    const res = await client(key).messages.create({
      model,
      max_tokens: 1024,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Reply with one short sentence confirming you can read this.' }],
    })
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
  },

  async extract({ key, model, system, parts, instruction, schema }) {
    const stream = client(key).messages.stream({
      model,
      max_tokens: 48000,
      system,
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: [...blocks(parts), { type: 'text', text: instruction }] }],
    })
    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') throw new PlainError('The model declined to read this document.')
    if (message.stop_reason === 'max_tokens') throw new PlainError('The document was too long to read in one pass. The output was cut off, so nothing was kept.')
    const text = message.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') throw new PlainError('The model returned no readable result for this document.')
    try {
      return JSON.parse(text.text) as unknown
    } catch {
      throw new PlainError('The model returned a result that was not valid JSON. Try re-running this document.')
    }
  },

  async step({ key, model, system, tools, messages, effort }) {
    const res = await client(key).messages.create({
      model,
      max_tokens: 16000,
      system,
      tools: tools.map((t): Anthropic.Tool => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema })),
      // Effort is an Anthropic-only knob, so it lives in this adapter.
      output_config: { effort: effort ?? 'medium' },
      messages: toMessages(messages),
    })
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    return {
      text: res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join('\n\n'),
      toolUses: uses.map((u) => ({ id: u.id, name: u.name, input: (u.input ?? {}) as Record<string, unknown> })),
      stop: res.stop_reason === 'refusal' ? 'refusal' : res.stop_reason === 'max_tokens' ? 'max_tokens' : res.stop_reason === 'tool_use' && uses.length ? 'tool_use' : 'end',
      // The full content, thinking blocks included, goes back unchanged on the next round.
      carry: res.content,
    }
  },

  explainError(e) {
    if (e instanceof PlainError) return e.message
    if (e instanceof Anthropic.AuthenticationError) return 'That Anthropic API key was rejected. Check it and paste it again.'
    if (e instanceof Anthropic.PermissionDeniedError) return 'This key is not allowed to use this model. Pick another model in settings, or use a different key.'
    if (e instanceof Anthropic.NotFoundError) return 'The model was not found for this key. Pick another model in settings.'
    if (e instanceof Anthropic.RateLimitError) return 'Rate limit reached for this key. Wait a minute and try again.'
    if (e instanceof Anthropic.BadRequestError) {
      if (/credit|billing/i.test(e.message)) return 'This key is out of credit. Add credit in the Anthropic console or use another key.'
      return `Anthropic rejected the request: ${e.message}`
    }
    if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your network and try again.'
    if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status ?? ''}: ${e.message}`
    if (e instanceof Error) return e.message
    return String(e)
  },
}
