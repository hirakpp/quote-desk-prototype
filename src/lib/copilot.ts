import type { Llm, ToolDef } from './llm/index.ts'
import { runToolLoop } from './toolloop.ts'
import type { ChatTurn, LineItem, Question, Rfx } from './types.ts'

// RFx co-pilot: the buyer talks, the model edits the structured draft through tools.

export const EMPTY_RFX: Rfx = {
  id: 'RFQ-DRAFT',
  title: '',
  buyer: '',
  scope: '',
  currency: 'INR',
  period: 'year',
  quantityLabel: 'Quantity',
  refLabel: 'last year',
  attributes: [],
  lineItems: [],
  questionnaire: [],
  terms: {},
}

const TOOLS: ToolDef[] = [
  {
    name: 'set_header',
    description: 'Set the RFx title, buyer name and scope paragraph. Pass only the fields you want to change.',
    parameters: {
      type: 'object',
      properties: { title: { type: 'string' }, buyer: { type: 'string' }, scope: { type: 'string' } },
    },
  },
  {
    name: 'set_line_items',
    description:
      'Replace the full list of line items. Always send the complete list, including items you are keeping. Ids are assigned in order (L01, L02, ...).',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'Full description a vendor can quote against, including size, model or route.' },
              spec: { type: 'string', description: 'The short size or specification on its own, for example "300 x 200 x 150 mm".' },
              category: { type: 'string', description: 'A short group name used to subtotal lines, for example "3-ply cartons", "Laptops" or "North lanes".' },
              unit_weight_g: { type: ['number', 'null'], description: 'Weight of one unit in grams, if the buyer gave it. Do not guess.' },
              quantity: { type: 'number', description: 'Quantity asked for: annual volume for a rate contract, or the one-time quantity.' },
              unit: { type: 'string', description: 'Pricing unit asked of vendors, for example "piece", "unit" or "trip".' },
            },
            required: ['description', 'category', 'quantity'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'set_questionnaire',
    description: 'Replace the full supplier questionnaire. Mark quality_gate true on questions a vendor must pass to be eligible for award.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, quality_gate: { type: 'boolean' } },
            required: ['text', 'quality_gate'],
          },
        },
      },
      required: ['questions'],
    },
  },
  {
    name: 'set_terms',
    description: 'Set commercial terms as short labelled lines. Replaces the terms you pass, keeps the others.',
    parameters: {
      type: 'object',
      properties: {
        priceBasis: { type: 'string' },
        delivery: { type: 'string' },
        payment: { type: 'string' },
        validity: { type: 'string' },
        responseDue: { type: 'string' },
      },
    },
  },
]

const SYSTEM = `You help a procurement buyer draft an RFx (request for quotation) by conversation. The draft is structured: header, line items, a supplier questionnaire and terms. You change it only through the tools. The current draft is given to you with each message.

- When the buyer describes what they need, write it into the draft straight away with the tools, then say briefly what you set and ask for the one or two things that matter most and are still missing (for example volumes, sizes, delivery point, quality requirements).
- Give every line a category so lines can be subtotalled.
- Do not invent volumes, sizes or weights the buyer did not give. If the buyer asks you to propose a typical list, you may, and you must say clearly that the figures are placeholders to be corrected.
- Suggest quality-gate questions that fit the category, and mark them as quality gate only if the buyer agrees or asked you to draft them.
- Keep replies short and plain. No em dashes.`

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function askCopilot(
  llm: Llm,
  draft: Rfx,
  history: ChatTurn[],
  userText: string,
): Promise<{ text: string; draft: Rfx; toolCalls: ChatTurn['toolCalls'] }> {
  let d: Rfx = { ...draft }
  const exec = (name: string, input: Record<string, unknown>): unknown => {
    if (name === 'set_header') {
      d = {
        ...d,
        title: typeof input.title === 'string' ? input.title : d.title,
        buyer: typeof input.buyer === 'string' ? input.buyer : d.buyer,
        scope: typeof input.scope === 'string' ? input.scope : d.scope,
      }
      return { ok: true }
    }
    if (name === 'set_line_items') {
      const items = Array.isArray(input.items) ? (input.items as Record<string, unknown>[]) : []
      const lineItems: LineItem[] = items.map((it, i) => {
        const g = num(it.unit_weight_g)
        return {
          id: `L${String(i + 1).padStart(2, '0')}`,
          description: String(it.description ?? ''),
          spec: typeof it.spec === 'string' && it.spec ? it.spec : undefined,
          category: typeof it.category === 'string' && it.category ? it.category : 'Other',
          measures: (g ? { kg: g / 1000 } : {}) as Record<string, number>,
          quantity: num(it.quantity) ?? 0,
          unit: typeof it.unit === 'string' && it.unit ? it.unit : 'piece',
          refPrice: null,
        }
      })
      d = { ...d, lineItems }
      return { ok: true, line_count: lineItems.length }
    }
    if (name === 'set_questionnaire') {
      const qs = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : []
      const questionnaire: Question[] = qs.map((q, i) => ({ id: `Q${i + 1}`, text: String(q.text ?? ''), gate: q.quality_gate === true }))
      d = { ...d, questionnaire }
      return { ok: true, question_count: questionnaire.length }
    }
    if (name === 'set_terms') {
      const terms = { ...d.terms }
      for (const [k, v] of Object.entries(input)) if (typeof v === 'string') terms[k] = v
      d = { ...d, terms }
      return { ok: true }
    }
    return { error: `Unknown tool ${name}` }
  }
  const brief = {
    title: draft.title,
    buyer: draft.buyer,
    scope: draft.scope,
    line_items: draft.lineItems.map((l) => ({ id: l.id, description: l.description, category: l.category, quantity: l.quantity, unit: l.unit })),
    questionnaire: draft.questionnaire,
    terms: draft.terms,
  }
  const res = await runToolLoop({
    llm,
    system: SYSTEM,
    tools: TOOLS,
    history,
    userText: `Current draft:\n${JSON.stringify(brief)}\n\nBuyer says: ${userText}`,
    exec,
    maxToolCalls: 6,
  })
  return { text: res.text, draft: d, toolCalls: res.toolCalls }
}
