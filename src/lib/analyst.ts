import { MAX_TOOL_CALLS } from '../config.ts'
import { aggregate, awardScenario, buildChart, getGrid } from './analysis.ts'
import type { AggregateInput, AwardInput, GetGridInput } from './analysis.ts'
import type { Llm, ToolDef } from './llm/index.ts'
import { lineCategory } from './normalize.ts'
import { runToolLoop } from './toolloop.ts'
import type { AnalystAnswer, ChatTurn, Grid, Rfx, ToolCallRecord } from './types.ts'

const vendorsParam = {
  type: 'array',
  items: { type: 'string' },
  description: 'Vendor ids or names. Leave out for all vendors.',
}

const scenarioProps = {
  name: { type: 'string', description: 'A short plain title for this scenario, shown on its card. For example "Split among gate-cleared vendors".' },
  eligible_vendors: {
    description: '"all", "passed_quality_gate" (only vendors with every quality-gate answer a yes), or a list of vendor ids or names.',
    anyOf: [{ type: 'string', enum: ['all', 'passed_quality_gate'] }, { type: 'array', items: { type: 'string' } }],
  },
  max_vendors: { type: 'integer', description: 'Cap on how many vendors can share the award. Leave out for no cap. 1 gives the best single vendor.' },
  fewest_vendors: { type: 'boolean', description: 'Use the smallest number of vendors that still covers as many lines as possible, then the cheapest such set. Use it for "fewest vendors that cover everything".' },
  use_unconfirmed_prices: { type: 'boolean', description: 'Include prices the buyer has not confirmed yet. Default true.' },
  exact_match_only: { type: 'boolean', description: 'Leave out prices for substitute items, and items where the match is unsure.' },
  require: {
    type: 'array',
    description: 'Filters on line attributes the RFx asked for. A price with no stated value for the attribute is left out.',
    items: {
      type: 'object',
      properties: { attribute: { type: 'string' }, op: { type: 'string', enum: ['max', 'min'] }, value: { type: 'number' } },
      required: ['attribute', 'op', 'value'],
    },
  },
  respect_capacity: {
    type: 'boolean',
    description: 'Do not give a vendor more on a line than the supply limit it stated for that line. Fills cheapest first and spills to the next vendor. Limits are per line only. A fleet-wide limit across lines is not modelled, so do not claim one.',
  },
  quantity_overrides: {
    type: 'array',
    description: 'What-if: use a different quantity on some lines. Code re-picks any quantity price break. Give line_ids or a category.',
    items: { type: 'object', properties: { line_ids: { type: 'array', items: { type: 'string' } }, category: { type: 'string' }, quantity: { type: 'number' } }, required: ['quantity'] },
  },
  include_addons: { type: 'array', items: { type: 'string' }, description: 'Add-on keys to add to the price where the vendor priced them, for example ["warranty_3y"].' },
  price_adjustments: {
    type: 'array',
    description: 'What-if: move named vendors\' prices by a percent. Hypothetical, and the result is labelled so.',
    items: { type: 'object', properties: { vendors: vendorsParam, percent: { type: 'number' } }, required: ['vendors', 'percent'] },
  },
  index_changes: {
    type: 'array',
    description: 'What-if: an index a vendor tied prices to moves, for example diesel up 5. Code applies each vendor\'s own stated clause. Never work the percent out yourself.',
    items: { type: 'object', properties: { index: { type: 'string' }, change: { type: 'number' } }, required: ['index', 'change'] },
  },
}

export const ANSWER_TOOL = 'answer'

export const ANALYST_TOOLS: ToolDef[] = [
  {
    name: 'get_grid',
    description:
      'Read the comparison grid: price per RFx unit and status for each line and vendor, plus per-vendor facts (lines priced, freight, GST, discount, quality gate, open rules, warnings). Use filters to keep it small. Use this for "what came back", "what can I not trust yet", looking up specific lines, substitutes, attributes and questionnaire answers.',
    parameters: {
      type: 'object',
      properties: {
        vendors: vendorsParam,
        line_ids: { type: 'array', items: { type: 'string' }, description: 'RFx line ids such as L07. Leave out for all lines.' },
        category: { type: 'string', description: 'One line category, as named in the system prompt.' },
        only: {
          type: 'string',
          enum: ['all', 'unconfirmed', 'needs_a_look', 'missing', 'substitute', 'converted'],
          description: 'Only return cells of this kind. substitute returns items that are not an exact match.',
        },
        include_questionnaire: { type: 'boolean', description: 'Include every vendor\'s questionnaire answers.' },
        include_reasons: { type: 'boolean', description: 'Include the plain reason on each cell that needs a look.' },
        include_attributes: { type: 'boolean', description: 'Include line attributes, add-on prices, supply limits and quantity price breaks.' },
      },
    },
  },
  {
    name: 'aggregate',
    description:
      'Sums and comparisons computed in code. group_by "vendor": cost of priced lines, like-for-like cost, pct vs the buyer\'s reference price, add-on costs. "category": lowest and median cost per category vs reference. "line": per line lowest price, lowest vendor, median, how many vendors priced it, pct vs reference, and with `attribute` the vendor that is best on that attribute and how much dearer it is than the lowest. "vendor_and_category": cost per vendor per category. Supports filter, sort_by on any returned numeric field, and top_n.',
    parameters: {
      type: 'object',
      properties: {
        group_by: { type: 'string', enum: ['vendor', 'category', 'line', 'vendor_and_category'] },
        vendors: vendorsParam,
        use_unconfirmed_prices: { type: 'boolean', description: 'Include prices the buyer has not confirmed yet. Default true.' },
        exact_match_only: { type: 'boolean', description: 'Leave out substitute and unsure items.' },
        attribute: { type: 'string', description: 'With group_by "line": an attribute key to compare the best-on-attribute vendor against the cheapest.' },
        filter: {
          type: 'object',
          description: 'Keep only rows where a numeric field passes a test, for example {field: "vendors_pricing", op: "eq", value: 1}.',
          properties: { field: { type: 'string' }, op: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte', 'eq'] }, value: { type: 'number' } },
          required: ['field', 'op', 'value'],
        },
        sort_by: { type: 'string', description: 'A numeric field of the returned rows.' },
        sort_direction: { type: 'string', enum: ['asc', 'desc'], description: 'Default desc.' },
        top_n: { type: 'integer' },
      },
      required: ['group_by'],
    },
  },
  {
    name: 'award_scenario',
    description:
      'Compute an award: cheapest usable price per line among eligible vendors, under optional conditions. Returns the split, total, saving vs the buyer\'s reference prices, the best single eligible vendor, the cheapest single vendor ignoring eligibility, how many prices used are unconfirmed, and caveats. The buyer sees the result as a card and it is pinned to a scenario tray. This never awards anything, it only computes.',
    parameters: { type: 'object', properties: scenarioProps, required: ['name', 'eligible_vendors'] },
  },
  {
    name: 'render_chart',
    description:
      'Draw one bar chart for the buyer. The bars are computed in code from the same grouping as the aggregate tool, so you pass the grouping and the metric, not the numbers. metric must be a numeric field that aggregate returns for that group_by. Set stacked true with group_by "vendor_and_category" and a cost metric to stack categories per vendor.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        group_by: { type: 'string', enum: ['vendor', 'category', 'line', 'vendor_and_category'] },
        metric: { type: 'string', description: 'For example cost, like_for_like_cost, pct_vs_reference, pct_median_vs_reference, pct_lowest_vs_reference, lowest_cost.' },
        stacked: { type: 'boolean' },
        vendors: vendorsParam,
        use_unconfirmed_prices: { type: 'boolean' },
        exact_match_only: { type: 'boolean' },
        sort_by: { type: 'string' },
        sort_direction: { type: 'string', enum: ['asc', 'desc'] },
        top_n: { type: 'integer' },
      },
      required: ['title', 'group_by', 'metric'],
    },
  },
  {
    name: 'export_xlsx',
    description:
      'Put a download button in front of the buyer for an Excel file. kind "comparison_grid" exports the full grid with cell status and source quotes. kind "award_scenario" exports an award computed with the given scenario settings.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['comparison_grid', 'award_scenario'] },
        scenario: { type: 'object', description: 'Same settings as award_scenario. Needed when kind is award_scenario.', properties: scenarioProps },
      },
      required: ['kind'],
    },
  },
  {
    name: ANSWER_TOOL,
    description:
      'Hand over your finished answer. Always end by calling this, exactly once, after any other tools. The buyer sees these fields laid out in a fixed shape, with any award card or chart from this turn under the points.',
    parameters: {
      type: 'object',
      properties: {
        headline: { type: 'string', description: 'One or two sentences. The answer itself, with the key figure if there is one.' },
        points: { type: 'array', items: { type: 'string' }, description: 'Up to 3 short supporting facts. When an award card or chart is shown, explain it, do not repeat its figures.' },
        caveats: { type: 'array', items: { type: 'string' }, description: 'Up to 2, and only ones that change what the buyer should do. Say each once. Empty when there are none.' },
        follow_ups: { type: 'array', items: { type: 'string' }, description: 'Up to 3 next questions the buyer could ask, each one this data can answer.' },
      },
      required: ['headline', 'points', 'caveats', 'follow_ups'],
    },
  },
]

function system(rfx: Rfx, grid: Grid): string {
  const vendors = grid.vendors.map((v) => `${v.replyId} = ${v.name}`).join('; ')
  const cats = [...new Set(grid.lines.map(lineCategory))].join(', ')
  const attrs = rfx.attributes.map((a) => `${a.key} (${a.label}${a.unit ? `, ${a.unit}` : ''})`).join('; ')
  const unit = grid.lines[0]?.unit ?? 'unit'
  return `You are the analyst inside a quote comparison tool. A procurement buyer is deciding how to award "${rfx.title}" (${grid.lines.length} line items, prices in ${rfx.currency} per ${unit}, ${rfx.period === 'year' ? 'annual quantities' : 'a one-time purchase'}). Vendor replies have been read by a model and normalised by code into one grid.
Vendors: ${vendors || 'none yet'}.
Line categories: ${cats || 'none'}.
Line attributes the RFx asked for: ${attrs || 'none'}.
The buyer's reference price for each line is their "${rfx.refLabel}" price.

How you work
- Every figure you state must come from a tool result in this conversation. Do not do arithmetic yourself, not even a subtraction or a percent. If you need a number that no tool returned, call a tool for it, or say it is not available.
- You have at most ${MAX_TOOL_CALLS} tool calls per question, not counting the final answer call. Most questions need one or two.
- Prices have a status. "confirmed" is safe. "under_unaccepted_rule" means code converted it by a rule (unit, currency, discount, a reference price, a quantity break, a minimum order) the buyer has not accepted yet. "needs_a_look" means code flagged that one price (far from other vendors or from the reference price, a substitute item, a reader's note). Both count as unconfirmed. When your answer rests on unconfirmed prices, say how many, once.
- Pass on a caveat a tool returns when it changes what the buyer should do, for example freight not included, a conditional discount, a substitute item or a supply limit. A vendor that priced fewer lines is not cheaper, it is incomplete. Compare vendors on like_for_like_cost.
- When a vendor's minimum order on a line is above the quantity the line needs, code costs the line at the minimum. award_scenario returns what that adds as minimum_order_extra_cost, and aggregate by vendor returns minimum_order_extra_cost. When no line is priced by every vendor, like_for_like_cost is null: compare on coverage with award_scenario (fewest_vendors, max_vendors) instead.
- A what-if (changed quantities, moved prices, an index change) is hypothetical. Say so wherever you give its number.
- If the data cannot answer the question (for example delivery performance or anything else nobody was asked about), say so plainly and say what data would be needed. Do not estimate or fill in from general knowledge.
- You do not award. You lay out the option, its cost, and what the buyer should check before deciding.
- For a chart, call render_chart. For an Excel file, call export_xlsx. An award_scenario result is shown to the buyer as a card, so explain it, do not repeat every figure on it.

How you answer
- Always finish by calling the answer tool. Never write the answer as plain text.
- headline: the answer in one or two sentences. points: at most 3. caveats: at most 2. follow_ups: at most 3.
- Short. Plain words. No em dashes. No markdown.
- Use Indian number style for money: the *_display fields give lakh and crore figures, use those when present.`
}

export function execAnalystTool(grid: Grid, name: string, input: Record<string, unknown>): unknown {
  switch (name) {
    case 'get_grid':
      return getGrid(grid, input as GetGridInput)
    case 'aggregate':
      return aggregate(grid, input as AggregateInput)
    case 'award_scenario':
      return awardScenario(grid, input as AwardInput)
    case 'render_chart':
      return buildChart(grid, input as AggregateInput & { title?: string; metric?: string; stacked?: boolean })
    case 'export_xlsx': {
      if (input.kind === 'award_scenario') {
        const check = awardScenario(grid, (input.scenario ?? { eligible_vendors: 'all' }) as AwardInput)
        if ('error' in check) return check
        return { ok: true, kind: 'award_scenario', message: 'A download button for the award workbook is now shown to the buyer.' }
      }
      return { ok: true, kind: 'comparison_grid', message: 'A download button for the comparison grid is now shown to the buyer.' }
    }
    default:
      return { error: `Unknown tool ${name}` }
  }
}

const strs = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, max) : [])

export async function askAnalyst(llm: Llm, rfx: Rfx, grid: Grid, history: ChatTurn[], question: string): Promise<{ text: string; answer: AnalystAnswer; toolCalls: ToolCallRecord[] }> {
  const res = await runToolLoop({
    llm,
    system: system(rfx, grid),
    tools: ANALYST_TOOLS,
    history,
    userText: question,
    exec: (name, input) => execAnalystTool(grid, name, input),
    maxToolCalls: MAX_TOOL_CALLS,
    finalTool: ANSWER_TOOL,
  })
  const f = res.final
  // If the model never called the answer tool, its prose becomes the headline rather than being dropped.
  const answer: AnalystAnswer = f
    ? { headline: typeof f.headline === 'string' ? f.headline : res.text, points: strs(f.points, 3), caveats: strs(f.caveats, 2), follow_ups: strs(f.follow_ups, 3) }
    : { headline: res.text, points: [], caveats: [], follow_ups: [] }
  // The plain-text form is what earlier turns are replayed as on the next question.
  const text = [answer.headline, ...answer.points.map((p) => `- ${p}`), ...answer.caveats.map((c) => `Caveat: ${c}`)].join('\n')
  return { text, answer, toolCalls: res.toolCalls }
}
