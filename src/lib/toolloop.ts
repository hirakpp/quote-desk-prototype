import type { Llm, LoopMessage, ToolDef } from './llm/index.ts'
import { PlainError } from './llm/index.ts'
import type { ChatTurn, ToolCallRecord } from './types.ts'

// Manual tool loop shared by the analyst and the RFx co-pilot. Same loop on every provider.
// Earlier questions are replayed as plain text. Within one question the provider's own
// assistant turn (thinking blocks or reasoning items) is passed back unchanged as `carry`.

export interface LoopOptions {
  llm: Llm
  system: string
  tools: ToolDef[]
  history: ChatTurn[]
  userText: string
  exec: (name: string, input: Record<string, unknown>) => unknown
  maxToolCalls: number
  effort?: 'low' | 'medium' | 'high'
  // A tool the model calls to hand over its finished answer. Calling it ends the loop
  // and does not count against maxToolCalls.
  finalTool?: string
}

export interface LoopResult {
  text: string
  toolCalls: ToolCallRecord[]
  final: Record<string, unknown> | null
}

export async function runToolLoop(o: LoopOptions): Promise<LoopResult> {
  const messages: LoopMessage[] = []
  for (const t of o.history) {
    if (t.error || !t.text.trim()) continue
    messages.push({ kind: t.role, text: t.text })
  }
  messages.push({ kind: 'user', text: o.userText })

  const toolCalls: ToolCallRecord[] = []
  const texts: string[] = []
  let nudged = false
  for (let round = 0; round < o.maxToolCalls + 5; round++) {
    const res = await o.llm.provider.step({ key: o.llm.key, model: o.llm.model, system: o.system, tools: o.tools, messages, effort: o.effort })
    if (res.text) texts.push(res.text)
    if (res.stop === 'refusal') throw new PlainError('The model declined to answer this.')
    if (res.stop === 'max_tokens') throw new PlainError('The answer was cut off before it finished. Try a narrower question.')

    const final = o.finalTool ? res.toolUses.find((u) => u.name === o.finalTool) : undefined
    if (final) return { text: texts.length ? texts[texts.length - 1] : '', toolCalls, final: final.input }

    if (res.stop !== 'tool_use' || res.toolUses.length === 0) {
      // The model wrote prose instead of handing over through the final tool. Ask once, then accept the prose.
      if (o.finalTool && !nudged) {
        nudged = true
        messages.push({ kind: 'carry', carry: res.carry })
        messages.push({ kind: 'user', text: `Hand over your answer now by calling the ${o.finalTool} tool. Do not write it as plain text.` })
        continue
      }
      break
    }

    messages.push({ kind: 'carry', carry: res.carry })
    const results: { id: string; name: string; content: string; isError: boolean }[] = []
    for (const u of res.toolUses) {
      if (toolCalls.length >= o.maxToolCalls) {
        results.push({
          id: u.id,
          name: u.name,
          isError: true,
          content: `Tool call limit of ${o.maxToolCalls} reached for this question. Answer now with what you already have, and say what you could not check.`,
        })
        continue
      }
      let result: unknown
      let isError = false
      try {
        result = o.exec(u.name, u.input)
        if (result && typeof result === 'object' && 'error' in result) isError = true
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) }
        isError = true
      }
      toolCalls.push({ name: u.name, input: u.input, result, isError })
      results.push({ id: u.id, name: u.name, isError, content: JSON.stringify(result) })
    }
    messages.push({ kind: 'tool_results', results })
  }
  // Text written before tool calls is working chatter. The last text block is the answer.
  return { text: texts.length ? texts[texts.length - 1] : '(no answer text returned)', toolCalls, final: null }
}
