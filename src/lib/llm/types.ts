import type { ProviderId } from '../types.ts'

// Provider-neutral shapes. Each adapter maps these to its own API.

// One piece of a vendor document as the model receives it.
export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mediaType: string; base64: string }
  | { kind: 'pdf'; base64: string; fileName: string }

export interface ToolDef {
  name: string
  description: string
  // JSON Schema for the arguments, type "object".
  parameters: Record<string, unknown>
}

// One entry of a tool loop's running history.
export type LoopMessage =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  // The provider's own assistant turn (with thinking blocks or reasoning items), passed back untouched.
  | { kind: 'carry'; carry: unknown }
  | { kind: 'tool_results'; results: { id: string; name: string; content: string; isError: boolean }[] }

export interface StepResult {
  text: string
  toolUses: { id: string; name: string; input: Record<string, unknown> }[]
  stop: 'end' | 'tool_use' | 'max_tokens' | 'refusal'
  carry: unknown
}

export interface Provider {
  id: ProviderId
  listModels(key: string): Promise<{ id: string; label: string }[]>
  test(key: string, model: string): Promise<string>
  // One document in, strict JSON out.
  extract(a: { key: string; model: string; system: string; parts: Part[]; instruction: string; schema: Record<string, unknown> }): Promise<unknown>
  // One round of a tool loop.
  step(a: { key: string; model: string; system: string; tools: ToolDef[]; messages: LoopMessage[]; effort?: 'low' | 'medium' | 'high' }): Promise<StepResult>
  explainError(e: unknown): string
}

// Errors the app raises itself, already in plain words.
export class PlainError extends Error {}
