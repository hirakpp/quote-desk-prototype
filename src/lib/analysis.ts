import { extrasLabel, inrShort, isUnconfirmed, lineCategory, median, priceAtQuantity, r2 } from './normalize.ts'
import type { Cell, Grid, LineItem, VendorSummary } from './types.ts'

// The analyst's numbers come from these functions. Plain code, no model.

const pct = (now: number, before: number) => (before ? r2(((now - before) / before) * 100) : null)

function usable(cell: Cell | undefined, useUnconfirmed: boolean): cell is Cell & { unitPrice: number } {
  if (!cell || cell.unitPrice == null) return false
  return useUnconfirmed || !isUnconfirmed(cell)
}

const cellStatus = (c: Cell) =>
  c.check === 'not_quoted' ? 'not_quoted' : c.check === 'no_price' ? 'no_usable_price' : c.check === 'look' ? 'needs_a_look' : c.ruleOpen ? 'under_unaccepted_rule' : 'confirmed'

// Accepts reply ids or vendor names (any case, partial is fine).
export function resolveVendors(grid: Grid, wanted: unknown): VendorSummary[] {
  if (!Array.isArray(wanted) || wanted.length === 0) return grid.vendors
  const found: VendorSummary[] = []
  for (const w of wanted) {
    const s = String(w).trim().toLowerCase()
    const v =
      grid.vendors.find((x) => x.replyId.toLowerCase() === s) ??
      grid.vendors.find((x) => x.name.toLowerCase() === s) ??
      grid.vendors.find((x) => x.name.toLowerCase().includes(s) || s.includes(x.name.toLowerCase()))
    if (v && !found.includes(v)) found.push(v)
  }
  return found
}

const vendorBrief = (grid: Grid, v: VendorSummary) => ({
  id: v.replyId,
  name: v.name,
  lines_priced: `${v.linesQuoted} of ${v.totalLines}`,
  quality_gate: v.gate,
  [extrasLabel(grid.rfx).toLowerCase().replace(/[^a-z]+/g, '_')]: v.freight,
  gst: v.gst,
  discount: v.discount ? { percent: v.discount.percent, condition: v.discount.condition, applied_in_prices: v.discount.applied, buyer_has_decided: v.discount.decided } : null,
  index_clause: v.indexClause ? { index: v.indexClause.indexName, percent_per_unit_rise: v.indexClause.percentPerUnit, quote: v.indexClause.quote } : null,
  like_for_like_total: v.likeForLike,
  like_for_like_total_display: inrShort(v.likeForLike),
  total_is_provisional: v.provisional,
  prices_under_an_unaccepted_rule: v.counts.underOpenRule,
  prices_needing_a_look: v.counts.look,
  open_rules: grid.rules.filter((r) => r.replyId === v.replyId && !r.accepted).map((r) => r.title),
  warnings: grid.blockers.filter((b) => b.replyId === v.replyId).map((b) => b.title),
})

// ---------- get_grid ----------
export interface GetGridInput {
  vendors?: string[]
  line_ids?: string[]
  category?: string
  only?: string
  include_questionnaire?: boolean
  include_reasons?: boolean
  include_attributes?: boolean
}

export function getGrid(grid: Grid, input: GetGridInput) {
  const vendors = resolveVendors(grid, input.vendors)
  const lineSet = Array.isArray(input.line_ids) && input.line_ids.length ? new Set(input.line_ids) : null
  const only = input.only && input.only !== 'all' ? input.only : null
  const keep = (c: Cell) => {
    if (!only) return true
    if (only === 'unconfirmed') return isUnconfirmed(c)
    if (only === 'needs_a_look') return c.check === 'look' || c.check === 'no_price'
    if (only === 'missing') return c.unitPrice == null
    if (only === 'substitute') return c.match !== 'exact'
    if (only === 'converted') return c.basis === 'converted' || c.basis === 'assumed'
    return true
  }
  const cat = input.category?.toLowerCase()
  const rows = grid.lines
    .filter((l) => (!lineSet || lineSet.has(l.id)) && (!cat || lineCategory(l).toLowerCase() === cat))
    .map((l) => {
      const prices: Record<string, unknown> = {}
      for (const v of vendors) {
        const c = grid.cells[v.replyId][l.id]
        if (!keep(c)) continue
        const entry: Record<string, unknown> = { price: c.unitPrice, status: cellStatus(c) }
        if (c.basis && c.basis !== 'quoted') entry.basis = c.basis
        if (c.match !== 'exact') {
          entry.match = c.match
          if (c.offered) entry.offered_item = c.offered
        }
        if (input.include_reasons && (c.check === 'look' || c.check === 'no_price')) entry.reasons = c.doubts.filter((r) => !r.confirmed).map((r) => r.text)
        if (input.include_attributes) {
          const at = Object.fromEntries(Object.entries(c.attributes).map(([k, a]) => [k, a.num ?? a.text]))
          if (Object.keys(at).length) entry.attributes = at
          if (c.addons.length) entry.addons = Object.fromEntries(c.addons.map((a) => [a.key, a.unitPrice]))
          if (c.capacity != null) entry.capacity_per_period = c.capacity
          if (c.moq != null) entry.minimum_order_quantity = c.moq
          if (c.tiers.length) entry.price_by_quantity = c.tiers.map((t) => ({ from_quantity: t.minQty, price: t.unitPrice }))
        }
        prices[v.replyId] = entry
      }
      return { line: l.id, description: l.description, category: lineCategory(l), quantity: l.quantity, reference_price: l.refPrice, prices }
    })
    .filter((r) => !only || Object.keys(r.prices).length > 0)
  const out: Record<string, unknown> = {
    note: `Prices are ${grid.rfx.currency} per ${grid.lines[0]?.unit ?? 'unit'} after code conversion. reference_price is the buyer's ${grid.rfx.refLabel} price. status is confirmed, under_unaccepted_rule, needs_a_look, no_usable_price or not_quoted.`,
    attributes_asked_for: grid.rfx.attributes.map((a) => ({ key: a.key, label: a.label, unit: a.unit ?? null })),
    vendors: vendors.map((v) => vendorBrief(grid, v)),
    lines: rows,
  }
  if (input.include_questionnaire) {
    out.questionnaire = grid.questionnaire.map((q) => ({
      id: q.id,
      quality_gate: q.gate,
      question: q.text,
      answers: Object.fromEntries(
        vendors.map((v) => {
          const a = v.answers[q.id]
          return [v.replyId, a?.answered ? { answer: a.answer, ...(q.gate ? { meets_requirement: a.meets_requirement } : {}) } : 'not answered']
        }),
      ),
    }))
  }
  return out
}

// ---------- aggregate ----------
export interface AggregateInput {
  group_by?: string
  vendors?: string[]
  use_unconfirmed_prices?: boolean
  exact_match_only?: boolean
  attribute?: string
  sort_by?: string
  sort_direction?: string
  top_n?: number
  filter?: { field?: string; op?: string; value?: number }
}

export type AggRow = { label: string } & Record<string, string | number | null>

export function aggregate(grid: Grid, input: AggregateInput): { group_by: string; rows: AggRow[]; note: string } | { error: string } {
  const vendors = resolveVendors(grid, input.vendors)
  const useUnc = input.use_unconfirmed_prices ?? true
  const groupBy = input.group_by ?? 'vendor'
  let rows: AggRow[] = []
  let note = ''
  const cats = [...new Set(grid.lines.map(lineCategory))]
  const ok = (c: Cell | undefined): c is Cell & { unitPrice: number } => usable(c, useUnc) && (!input.exact_match_only || c.match === 'exact')
  const addonKeys = [...new Set(grid.vendors.flatMap((v) => grid.lines.flatMap((l) => grid.cells[v.replyId][l.id].addons.map((a) => a.key))))]

  const sumFor = (v: VendorSummary, lines: LineItem[] = grid.lines) => {
    let cost = 0
    let ref = 0
    let n = 0
    let unc = 0
    let subs = 0
    let moqExtra = 0
    const addon: Record<string, number> = {}
    const addonLines: Record<string, number> = {}
    for (const l of lines) {
      const c = grid.cells[v.replyId][l.id]
      if (!ok(c)) continue
      n++
      cost += c.unitPrice * Math.max(l.quantity, c.moq ?? 0)
      moqExtra += c.unitPrice * Math.max(0, (c.moq ?? 0) - l.quantity)
      if (isUnconfirmed(c)) unc++
      if (c.match !== 'exact') subs++
      if (l.refPrice != null) ref += l.refPrice * l.quantity
      for (const a of c.addons) {
        addon[a.key] = (addon[a.key] ?? 0) + a.unitPrice * l.quantity
        addonLines[a.key] = (addonLines[a.key] ?? 0) + 1
      }
    }
    return { cost: r2(cost), ref: r2(ref), n, unc, subs, addon, addonLines, moqExtra: r2(moqExtra) }
  }

  if (groupBy === 'vendor') {
    note =
      'cost covers only the lines each vendor priced, so vendors with fewer lines look cheaper. like_for_like_cost covers only the lines every vendor priced and is the fair comparison. addon_* fields are the extra cost of an optional add-on over the lines where that vendor priced it.'
    rows = vendors.map((v) => {
      const s = sumFor(v)
      const row: AggRow = {
        label: v.name,
        vendor_id: v.replyId,
        lines_priced: s.n,
        lines_total: grid.lines.length,
        cost: s.cost,
        cost_display: inrShort(s.cost),
        like_for_like_cost: v.likeForLike,
        reference_cost_same_lines: s.ref,
        pct_vs_reference: pct(s.cost, s.ref),
        unconfirmed_prices_included: s.unc,
        substitute_or_unsure_items: s.subs,
        ...(s.moqExtra > 0 ? { minimum_order_extra_cost: s.moqExtra, minimum_order_extra_cost_display: inrShort(s.moqExtra) } : {}),
        freight: v.freight,
        quality_gate: v.gate,
      }
      for (const k of addonKeys) {
        row[`addon_${k}_cost`] = s.addon[k] != null ? r2(s.addon[k]) : null
        row[`addon_${k}_lines`] = s.addonLines[k] ?? 0
        row[`addon_${k}_pct_of_cost`] = s.addon[k] != null ? pct(s.cost + s.addon[k], s.cost) : null
      }
      return row
    })
  } else if (groupBy === 'vendor_and_category') {
    for (const v of vendors) {
      for (const cat of cats) {
        const lines = grid.lines.filter((l) => lineCategory(l) === cat)
        const s = sumFor(v, lines)
        rows.push({
          label: `${v.name}, ${cat}`,
          vendor: v.name,
          vendor_id: v.replyId,
          category: cat,
          lines_priced: s.n,
          lines_total: lines.length,
          cost: s.cost,
          reference_cost_same_lines: s.ref,
          pct_vs_reference: pct(s.cost, s.ref),
          unconfirmed_prices_included: s.unc,
        })
      }
    }
  } else if (groupBy === 'category' || groupBy === 'line') {
    const def = input.attribute ? grid.rfx.attributes.find((a) => a.key === input.attribute) : undefined
    if (input.attribute && !def) return { error: `Unknown attribute "${input.attribute}". This RFx asked for: ${grid.rfx.attributes.map((a) => a.key).join(', ') || 'none'}.` }
    const perLine = grid.lines.map((l) => {
      const quotes = vendors.map((v) => ({ v, c: grid.cells[v.replyId][l.id] })).filter((x) => ok(x.c)).map((x) => ({ v: x.v, c: x.c, price: x.c.unitPrice as number }))
      const low = quotes.length ? quotes.reduce((a, b) => (b.price < a.price ? b : a)) : null
      const med = quotes.length ? r2(median(quotes.map((q) => q.price))) : null
      let best: (typeof quotes)[number] | null = null
      if (def && def.better !== 'none') {
        for (const q of quotes) {
          const n = q.c.attributes[def.key]?.num
          if (n == null) continue
          const bn = best?.c.attributes[def.key]?.num
          if (bn == null || (def.better === 'lower' ? n < bn : n > bn)) best = q
        }
      }
      return { l, quotes, low, med, best }
    })
    if (groupBy === 'line') {
      note = `lowest and median are across the selected vendors. pct fields compare with the buyer's ${grid.rfx.refLabel} price for the same line.${def ? ` best_${def.key}_* is the vendor with the best ${def.label} on that line and what it costs against the lowest price.` : ''}`
      rows = perLine.map(({ l, quotes, low, med, best }) => {
        const row: AggRow = {
          label: `${l.id} ${l.spec ?? l.description.slice(0, 40)}`,
          line: l.id,
          category: lineCategory(l),
          quantity: l.quantity,
          reference_price: l.refPrice,
          vendors_pricing: quotes.length,
          lowest_price: low?.price ?? null,
          lowest_vendor: low?.v.name ?? null,
          median_price: med,
          pct_lowest_vs_reference: low && l.refPrice ? pct(low.price, l.refPrice) : null,
          pct_median_vs_reference: med != null && l.refPrice ? pct(med, l.refPrice) : null,
        }
        if (def) {
          row[`best_${def.key}_vendor`] = best?.v.name ?? null
          row[`best_${def.key}_value`] = best?.c.attributes[def.key]?.num ?? null
          row[`best_${def.key}_price`] = best?.price ?? null
          row[`lowest_price_vendor_${def.key}`] = low?.c.attributes[def.key]?.num ?? null
          row[`pct_best_${def.key}_dearer_than_lowest`] = best && low ? pct(best.price, low.price) : null
        }
        return row
      })
    } else {
      note = 'lowest_cost takes the lowest usable price per line across the selected vendors.'
      rows = cats.map((cat) => {
        const ls = perLine.filter((x) => lineCategory(x.l) === cat)
        let cost = 0
        let ref = 0
        let medCost = 0
        let covered = 0
        for (const x of ls) {
          if (!x.low) continue
          covered++
          cost += x.low.price * x.l.quantity
          medCost += (x.med ?? 0) * x.l.quantity
          ref += (x.l.refPrice ?? 0) * x.l.quantity
        }
        return {
          label: cat,
          lines_total: ls.length,
          lines_with_a_price: covered,
          lowest_cost: r2(cost),
          median_cost: r2(medCost),
          reference_cost: r2(ref),
          pct_lowest_vs_reference: pct(cost, ref),
          pct_median_vs_reference: pct(medCost, ref),
        }
      })
    }
  } else {
    return { error: `Unknown group_by "${groupBy}". Use vendor, category, line or vendor_and_category.` }
  }

  const f = input.filter
  if (f?.field && typeof f.value === 'number') {
    if (rows.length && !(f.field in rows[0])) return { error: `Cannot filter on "${f.field}". Fields available: ${Object.keys(rows[0]).join(', ')}` }
    const val = f.value
    rows = rows.filter((r) => {
      const x = r[f.field as string]
      if (typeof x !== 'number') return false
      return f.op === 'lt' ? x < val : f.op === 'eq' ? x === val : f.op === 'lte' ? x <= val : f.op === 'gte' ? x >= val : x > val
    })
  }
  if (input.sort_by) {
    const key = input.sort_by
    if (rows.length && !(key in rows[0])) return { error: `Cannot sort by "${key}". Fields available: ${Object.keys(rows[0]).join(', ')}` }
    const dir = input.sort_direction === 'asc' ? 1 : -1
    rows = [...rows].sort((a, b) => {
      const x = a[key]
      const y = b[key]
      if (x == null) return 1
      if (y == null) return -1
      return x < y ? -dir : x > y ? dir : 0
    })
  }
  if (input.top_n && input.top_n > 0) rows = rows.slice(0, input.top_n)
  return { group_by: groupBy, rows, note }
}

// ---------- award_scenario ----------
export interface AwardInput {
  name?: string
  eligible_vendors?: string | string[]
  max_vendors?: number
  fewest_vendors?: boolean
  use_unconfirmed_prices?: boolean
  exact_match_only?: boolean
  require?: { attribute?: string; op?: string; value?: number }[]
  respect_capacity?: boolean
  quantity_overrides?: { line_ids?: string[]; category?: string; quantity?: number }[]
  include_addons?: string[]
  price_adjustments?: { vendors?: string[]; percent?: number }[]
  index_changes?: { index?: string; change?: number }[]
}

export interface AwardLine {
  line: string
  description: string
  vendor_id: string
  vendor: string
  unit_price: number
  quantity: number
  // More than quantity when the vendor's minimum order is above what the line needs.
  billed_quantity: number
  cost: number
  reference_price: number | null
  unconfirmed: boolean
}

export interface AwardResult {
  name: string
  rule: string
  what_if: boolean
  what_if_notes: string[]
  eligible_vendors: string[]
  excluded_vendors: { vendor: string; reason: string }[]
  vendors_in_award: { vendor_id: string; vendor: string; lines: number; cost: number; cost_display: string; share_pct: number }[]
  lines_awarded: number
  lines_total: number
  lines_without_an_eligible_price: string[]
  lines_only_partly_filled: { line: string; quantity_unfilled: number }[]
  total_cost: number
  total_display: string
  // What minimum order quantities add to the total: units paid for beyond what the lines need.
  minimum_order_extra_cost: number
  reference_cost_same_lines: number
  saving_vs_reference: number
  saving_vs_reference_pct: number | null
  best_single_eligible_vendor: { vendor: string; cost: number; cost_display: string; extra_cost_vs_this_split: number } | null
  best_single_eligible_vendor_note: string
  cheapest_single_vendor_ignoring_eligibility: { vendor: string; cost: number; quality_gate: string; freight: string; extra_cost_vs_this_split: number } | null
  unconfirmed_prices_used: number
  rests_on: string
  caveats: string[]
  awards: AwardLine[]
}

function combos<T>(xs: T[], k: number): T[][] {
  if (k >= xs.length) return [xs]
  if (k === 0) return [[]]
  const [h, ...rest] = xs
  return [...combos(rest, k - 1).map((c) => [h, ...c]), ...combos(rest, k)]
}

export function awardScenario(grid: Grid, input: AwardInput): AwardResult | { error: string } {
  const useUnc = input.use_unconfirmed_prices ?? true
  const unit = grid.lines[0]?.unit ?? 'unit'
  let eligible: VendorSummary[]
  let ruleEligible: string
  const excluded: AwardResult['excluded_vendors'] = []
  const e = input.eligible_vendors ?? 'all'
  if (e === 'passed_quality_gate') {
    eligible = grid.vendors.filter((v) => v.gate === 'pass')
    ruleEligible = 'only vendors who cleared the quality gate'
    for (const v of grid.vendors) {
      if (v.gate === 'pass') continue
      const why =
        v.gate === 'fail'
          ? `failed: ${grid.questionnaire.filter((q) => q.gate && v.answers[q.id]?.meets_requirement === 'no').map((q) => q.id).join(', ')}`
          : v.gate === 'not_answered'
            ? 'did not answer the questionnaire'
            : 'a quality-gate answer is unclear or missing'
      excluded.push({ vendor: v.name, reason: why })
    }
  } else if (e === 'all') {
    eligible = grid.vendors
    ruleEligible = 'all vendors'
  } else {
    eligible = resolveVendors(grid, Array.isArray(e) ? e : [e])
    if (eligible.length === 0) return { error: 'None of the named vendors were found. Use vendor ids or names from get_grid.' }
    ruleEligible = `only ${eligible.map((v) => v.name).join(', ')}`
    for (const v of grid.vendors) if (!eligible.includes(v)) excluded.push({ vendor: v.name, reason: 'not in the list you gave' })
  }
  if (eligible.length === 0) return { error: 'No vendor is eligible under that rule, so there is nothing to award.' }

  // ---- constraints and what-ifs ----
  const ruleBits: string[] = []
  const whatIf: string[] = []
  const caveats: string[] = []
  const reqs = (input.require ?? []).filter((r) => r.attribute && typeof r.value === 'number')
  for (const r of reqs) {
    const def = grid.rfx.attributes.find((a) => a.key === r.attribute)
    if (!def) return { error: `Unknown attribute "${r.attribute}". This RFx asked for: ${grid.rfx.attributes.map((a) => a.key).join(', ') || 'none'}.` }
    ruleBits.push(`${def.label} ${r.op === 'min' ? 'at least' : 'at most'} ${r.value}${def.unit ? ` ${def.unit}` : ''}`)
  }
  if (input.exact_match_only) ruleBits.push('exact-match items only, no substitutes')
  if (input.respect_capacity) ruleBits.push('no vendor gets more than the supply limit it stated on a line')
  const addons = (input.include_addons ?? []).filter(Boolean)
  if (addons.length) ruleBits.push(`including add-on: ${addons.join(', ')}`)

  const qty = new Map(grid.lines.map((l) => [l.id, l.quantity]))
  for (const o of input.quantity_overrides ?? []) {
    if (typeof o.quantity !== 'number' || o.quantity < 0) continue
    const cat = o.category?.toLowerCase()
    const hit = grid.lines.filter((l) => (o.line_ids?.length ? o.line_ids.includes(l.id) : cat ? lineCategory(l).toLowerCase() === cat : false))
    if (hit.length === 0) return { error: `quantity_overrides matched no line. Categories: ${[...new Set(grid.lines.map(lineCategory))].join(', ')}.` }
    for (const l of hit) qty.set(l.id, o.quantity)
    whatIf.push(`Quantity set to ${o.quantity.toLocaleString('en-IN')} on ${hit.length} line(s) (${hit.map((l) => l.id).join(', ')}) instead of the RFx quantity.`)
  }
  const factor = new Map(grid.vendors.map((v) => [v.replyId, 1]))
  for (const a of input.price_adjustments ?? []) {
    if (typeof a.percent !== 'number') continue
    const vs = resolveVendors(grid, a.vendors)
    for (const v of vs) factor.set(v.replyId, (factor.get(v.replyId) ?? 1) * (1 + a.percent / 100))
    whatIf.push(`Prices of ${vs.map((v) => v.name).join(', ')} moved by ${a.percent > 0 ? '+' : ''}${a.percent}%. This is a hypothetical, not a quote.`)
  }
  for (const c of input.index_changes ?? []) {
    if (typeof c.change !== 'number' || !c.index) continue
    const name = c.index.toLowerCase()
    const hit = grid.vendors.filter((v) => v.indexClause && (v.indexClause.indexName.toLowerCase().includes(name) || name.includes(v.indexClause.indexName.toLowerCase())))
    for (const v of hit) factor.set(v.replyId, (factor.get(v.replyId) ?? 1) * (1 + (v.indexClause!.percentPerUnit * c.change) / 100))
    const none = grid.vendors.filter((v) => !hit.includes(v)).map((v) => v.name)
    whatIf.push(
      hit.length
        ? `${c.index} moved by ${c.change > 0 ? '+' : ''}${c.change}. Applied through the clause each of these vendors stated: ${hit.map((v) => `${v.name} (${v.indexClause!.percentPerUnit}% per unit)`).join(', ')}.`
        : `${c.index} moved by ${c.change}, but no vendor stated a clause tied to it, so no price changes.`,
    )
    if (hit.length && none.length) caveats.push(`${none.join(', ')} stated no ${c.index} clause. Their prices are left unchanged, which does not mean they are fixed.`)
  }

  // What a vendor would charge per unit on a line under this scenario, or null when it cannot be used.
  const option = (v: VendorSummary, l: LineItem, filters = true): { price: number; cell: Cell; cap: number | null; moq: number } | null => {
    const c = grid.cells[v.replyId][l.id]
    if (!usable(c, useUnc)) return null
    if (filters) {
      if (input.exact_match_only && c.match !== 'exact') return null
      for (const r of reqs) {
        const n = c.attributes[r.attribute as string]?.num
        if (n == null) return null
        if (r.op === 'min' ? n < (r.value as number) : n > (r.value as number)) return null
      }
    }
    let p = priceAtQuantity(c, qty.get(l.id) ?? l.quantity)
    if (p == null) return null
    for (const k of addons) {
      const a = c.addons.find((x) => x.key === k)
      if (a) p += a.unitPrice
    }
    p = p * (factor.get(v.replyId) ?? 1)
    return { price: r2(p), cell: c, cap: input.respect_capacity ? c.capacity : null, moq: c.moq ?? 0 }
  }

  const maxV = input.max_vendors && input.max_vendors > 0 ? Math.floor(input.max_vendors) : eligible.length

  const pick = (set: VendorSummary[]) => {
    const awards: AwardLine[] = []
    const none: string[] = []
    const partial: AwardResult['lines_only_partly_filled'] = []
    let total = 0
    let full = 0
    let moqExtra = 0
    for (const l of grid.lines) {
      const need = qty.get(l.id) ?? l.quantity
      const opts = set
        .map((v) => ({ v, o: option(v, l) }))
        .filter((x): x is { v: VendorSummary; o: NonNullable<ReturnType<typeof option>> } => x.o != null)
        // Cheapest for what the line needs, counting a minimum order above it.
        .sort((a, b) => a.o.price * Math.max(need, a.o.moq) - b.o.price * Math.max(need, b.o.moq))
      if (opts.length === 0) {
        none.push(l.id)
        continue
      }
      // Cheapest first. With supply limits, fill up to each vendor's limit and spill to the next.
      let left = need
      for (const { v, o } of opts) {
        if (left <= 0) break
        const take = o.cap == null ? left : Math.min(left, o.cap)
        if (take <= 0) continue
        const billed = Math.max(take, o.moq)
        const cost = r2(o.price * billed)
        total += cost
        moqExtra += o.price * (billed - take)
        left -= take
        awards.push({ line: l.id, description: l.description, vendor_id: v.replyId, vendor: v.name, unit_price: o.price, quantity: take, billed_quantity: billed, cost, reference_price: l.refPrice, unconfirmed: isUnconfirmed(o.cell) })
      }
      if (left > 0) partial.push({ line: l.id, quantity_unfilled: left })
      else full++
    }
    return { awards, none, partial, total: r2(total), full, moqExtra: r2(moqExtra) }
  }

  // Try every allowed set of vendors. Most lines fully covered wins, then lowest cost.
  const bestOf = (k: number) => {
    let best: ReturnType<typeof pick> | null = null
    for (const set of combos(eligible, Math.min(k, eligible.length))) {
      const p = pick(set)
      if (!best || p.full > best.full || (p.full === best.full && p.total < best.total)) best = p
    }
    return best as ReturnType<typeof pick>
  }
  let res = bestOf(maxV)
  let usedCap = maxV
  // Fewest vendors: the smallest number of vendors that still covers as many lines as the cap allows.
  if (input.fewest_vendors) {
    for (let k = 1; k < maxV; k++) {
      const p = bestOf(k)
      if (p.full === res.full) {
        res = p
        usedCap = k
        break
      }
    }
    ruleBits.push(`the fewest vendors that cover ${res.full} of ${grid.lines.length} lines (${usedCap})`)
  }

  const awardedIds = new Set(res.awards.map((a) => a.line))
  const awardedLines = grid.lines.filter((l) => awardedIds.has(l.id))
  const ref = r2(res.awards.reduce((s, a) => s + (a.reference_price ?? 0) * a.quantity, 0))
  const missingRef = awardedLines.filter((l) => l.refPrice == null).length

  // Single-vendor comparisons, over the same awarded lines, without supply limits.
  const singleTotal = (v: VendorSummary, filters: boolean) => {
    let t = 0
    for (const l of awardedLines) {
      const o = option(v, l, filters)
      if (!o) return null
      t += o.price * Math.max(qty.get(l.id) ?? l.quantity, o.moq)
    }
    return r2(t)
  }
  const singles = (vs: VendorSummary[], filters: boolean) =>
    vs
      .map((v) => ({ v, t: singleTotal(v, filters) }))
      .filter((x): x is { v: VendorSummary; t: number } => x.t != null)
      .sort((a, b) => a.t - b.t)
  const bestEligible = singles(eligible, true)[0]
  const bestAny = singles(grid.vendors, false)[0]

  const byVendor = new Map<string, { vendor_id: string; vendor: string; lines: number; cost: number }>()
  for (const a of res.awards) {
    const g = byVendor.get(a.vendor_id) ?? { vendor_id: a.vendor_id, vendor: a.vendor, lines: 0, cost: 0 }
    g.lines++
    g.cost = r2(g.cost + a.cost)
    byVendor.set(a.vendor_id, g)
  }
  const inAward = grid.vendors.filter((v) => byVendor.has(v.replyId))

  for (const v of inAward) {
    const ex = extrasLabel(grid.rfx).toLowerCase()
    if (v.freight === 'extra') caveats.push(`${v.name}: ${ex} not included, so its prices are not on the same basis as vendors who include it. No amount for it is in the data.`)
    if (v.freight === 'not_stated') caveats.push(`${v.name}: ${ex} not stated.`)
    if (v.discount?.condition && !v.discount.decided) caveats.push(`${v.name}: a ${v.discount.percent}% discount with a condition (${v.discount.condition}) is ${v.discount.applied ? 'applied' : 'not applied'} and the buyer has not decided on it yet.`)
    else if (v.discount?.applied && v.discount.condition) caveats.push(`${v.name}: prices include a ${v.discount.percent}% discount that has a condition (${v.discount.condition}).`)
    if (e !== 'passed_quality_gate' && v.gate !== 'pass') caveats.push(`${v.name}: quality gate status is "${v.gate}".`)
  }
  const unc = res.awards.filter((a) => a.unconfirmed).length
  const underRule = res.awards.filter((a) => grid.cells[a.vendor_id][a.line].ruleOpen).length
  const look = res.awards.filter((a) => grid.cells[a.vendor_id][a.line].check === 'look').length
  if (unc > 0) caveats.push(`${unc} of the ${res.awards.length} prices used are not confirmed by the buyer yet (${underRule} under a rule not accepted, ${look} needing a look).`)
  if (res.none.length > 0) caveats.push(`${res.none.length} line(s) have no usable price from an eligible vendor under these conditions and are left out of the total: ${res.none.join(', ')}.`)
  if (res.partial.length > 0) caveats.push(`${res.partial.length} line(s) cannot be filled in full within the stated supply limits: ${res.partial.map((p) => `${p.line} (${p.quantity_unfilled.toLocaleString('en-IN')} short)`).join(', ')}.`)
  if (res.moqExtra > 0) caveats.push(`Minimum order quantities add ${inrShort(res.moqExtra)}: on ${res.awards.filter((a) => a.billed_quantity > a.quantity).length} awarded line(s) the vendor's minimum is above what the line needs, and the total pays for the minimum.`)
  if (missingRef > 0) caveats.push(`${missingRef} awarded line(s) have no ${grid.rfx.refLabel} price, so the saving is understated or not comparable.`)
  if (addons.length) {
    const lacking = res.awards.filter((a) => addons.some((k) => !grid.cells[a.vendor_id][a.line].addons.some((x) => x.key === k))).length
    if (lacking > 0) caveats.push(`${lacking} awarded price(s) have no separate price for the add-on (${addons.join(', ')}). It may be included or may not be offered. Nothing was added for those.`)
  }
  if (input.respect_capacity) caveats.push('Supply limits are applied per line, as each vendor stated them. A vendor-wide fleet limit across lines is not modelled.')

  const restsOn =
    unc === 0
      ? 'Every price used is confirmed.'
      : `Uses ${unc} price${unc > 1 ? 's' : ''} you have not confirmed yet${underRule ? ` (${underRule} under a rule you have not accepted)` : ''}.`
  const rule = `Cheapest usable price per line, ${ruleEligible}${maxV < eligible.length ? `, at most ${maxV} vendor(s)` : ''}${ruleBits.length ? `, ${ruleBits.join(', ')}` : ''}. ${useUnc ? 'Unconfirmed prices are included.' : 'Unconfirmed prices are left out.'}`
  const total = res.total
  return {
    name: input.name?.trim() || defaultName(e, maxV < eligible.length ? maxV : null, ruleBits, whatIf.length > 0),
    rule,
    what_if: whatIf.length > 0,
    what_if_notes: whatIf,
    eligible_vendors: eligible.map((v) => v.name),
    excluded_vendors: excluded,
    vendors_in_award: [...byVendor.values()].map((g) => ({ ...g, cost_display: inrShort(g.cost), share_pct: total ? r2((g.cost / total) * 100) : 0 })),
    lines_awarded: awardedLines.length,
    lines_total: grid.lines.length,
    lines_without_an_eligible_price: res.none,
    lines_only_partly_filled: res.partial,
    total_cost: total,
    total_display: inrShort(total),
    minimum_order_extra_cost: res.moqExtra,
    reference_cost_same_lines: ref,
    saving_vs_reference: r2(ref - total),
    saving_vs_reference_pct: ref ? r2(((ref - total) / ref) * 100) : null,
    best_single_eligible_vendor: bestEligible ? { vendor: bestEligible.v.name, cost: bestEligible.t, cost_display: inrShort(bestEligible.t), extra_cost_vs_this_split: r2(bestEligible.t - total) } : null,
    best_single_eligible_vendor_note: bestEligible
      ? `Lowest total among eligible vendors who have a usable price on every awarded line. Per ${unit}, same conditions, supply limits not applied.`
      : 'No single eligible vendor has a usable price on every awarded line under these conditions.',
    cheapest_single_vendor_ignoring_eligibility: bestAny
      ? { vendor: bestAny.v.name, cost: bestAny.t, quality_gate: bestAny.v.gate, freight: bestAny.v.freight, extra_cost_vs_this_split: r2(bestAny.t - total) }
      : null,
    unconfirmed_prices_used: unc,
    rests_on: restsOn,
    caveats,
    awards: res.awards,
  }
}

function defaultName(e: string | string[], cap: number | null, bits: string[], whatIf: boolean): string {
  const who = e === 'passed_quality_gate' ? 'gate-cleared vendors' : e === 'all' ? 'all vendors' : 'named vendors'
  const shape = cap === 1 ? 'Best single vendor' : cap ? `Split, at most ${cap} vendors` : 'Split, cheapest per line'
  return `${whatIf ? 'What-if: ' : ''}${shape}, ${who}${bits.length ? `, ${bits[0]}` : ''}`
}

// ---------- chart ----------
export interface ChartSpec {
  title: string
  metric: string
  unit: string
  kind: 'bar' | 'stacked'
  bars: { label: string; value: number }[]
  // Stacked only: one row per label, one number per series.
  series: string[]
  rows: ({ label: string } & Record<string, number | string>)[]
}

export function buildChart(grid: Grid, input: AggregateInput & { title?: string; metric?: string; stacked?: boolean }): ChartSpec | { error: string } {
  const agg = aggregate(grid, input)
  if ('error' in agg) return agg
  const metric = input.metric ?? ''
  if (!agg.rows.length) return { error: 'There is no data to chart for that selection.' }
  const numeric = Object.keys(agg.rows[0]).filter((k) => typeof agg.rows[0][k] === 'number' || agg.rows[0][k] === null)
  if (!numeric.includes(metric)) return { error: `metric "${metric}" is not available for group_by ${agg.group_by}. Use one of: ${numeric.join(', ')}` }
  const unit = metric.startsWith('pct') ? '%' : metric.includes('cost') || metric.includes('price') ? '₹' : ''
  const title = input.title || `${metric} by ${agg.group_by}`
  if (input.stacked && agg.group_by === 'vendor_and_category' && unit !== '%') {
    const series = [...new Set(agg.rows.map((r) => String(r.category)))]
    const byVendor = new Map<string, { label: string } & Record<string, number | string>>()
    for (const r of agg.rows) {
      const row = byVendor.get(String(r.vendor)) ?? { label: String(r.vendor) }
      row[String(r.category)] = typeof r[metric] === 'number' ? (r[metric] as number) : 0
      byVendor.set(String(r.vendor), row)
    }
    return { title, metric, unit, kind: 'stacked', bars: [], series, rows: [...byVendor.values()] }
  }
  const bars = agg.rows.filter((r) => typeof r[metric] === 'number').map((r) => ({ label: r.label, value: r[metric] as number }))
  return { title, metric, unit, kind: 'bar', bars, series: [], rows: [] }
}
