import { FX_TO_INR, OFF_REFERENCE_SHARE, OUTLIER_FACTOR } from '../config.ts'
import type {
  Basis,
  Blocker,
  Cell,
  CellAttribute,
  Decisions,
  Doubt,
  DoubtCode,
  ExtractedItem,
  GateStatus,
  Grid,
  LineItem,
  Reply,
  Rfx,
  RuleCode,
  VendorSummary,
} from './types.ts'

// Everything here is plain code. No model calls. Units, currency, discounts, references,
// tiers, checks and cell states are all decided in this file.

export const r2 = (n: number) => Math.round(n * 100) / 100
export const cellKey = (replyId: string, lineId: string) => `${replyId}|${lineId}`
const trim = (n: number) => String(Math.round(n * 10000) / 10000)

export function inr(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return ''
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

// One unit per column: the caller picks the unit for a whole column with moneyUnit().
export type MoneyUnit = 'crore' | 'lakh' | 'rupee'
export const unitOf = (n: number): MoneyUnit => (Math.abs(n) >= 1e7 ? 'crore' : Math.abs(n) >= 1e5 ? 'lakh' : 'rupee')
export function moneyUnit(values: (number | null | undefined)[]): MoneyUnit {
  const xs = values.filter((v): v is number => v != null && !Number.isNaN(v)).map(Math.abs)
  return xs.length ? unitOf(Math.max(...xs)) : 'rupee'
}
export function moneyParts(n: number, unit: MoneyUnit = unitOf(n), digits = 2): { figure: string; unit: string } {
  if (unit === 'crore') return { figure: `₹${(n / 1e7).toFixed(digits)}`, unit: 'crore' }
  if (unit === 'lakh') return { figure: `₹${(n / 1e5).toFixed(digits)}`, unit: 'lakh' }
  return { figure: inr(n, 0), unit: '' }
}
export function inrShort(n: number | null | undefined, unit?: MoneyUnit, digits = 2): string {
  if (n == null || Number.isNaN(n)) return ''
  const p = moneyParts(n, unit, digits)
  return p.unit ? `${p.figure} ${p.unit}` : p.figure
}

// Unit prices range from a few rupees (cartons) to lakhs (laptops, truck trips).
export const price = (n: number | null | undefined) => (n == null ? '' : inr(n, Math.abs(n) >= 1000 ? 0 : 2))

export const lineCategory = (l: LineItem) => l.category || 'other'
export const perPeriod = (rfx: Rfx) => (rfx.period === 'year' ? ' a year' : '')
// The same, for use after a noun phrase: "27 shared lines, a year".
export const perComma = (rfx: Rfx) => (rfx.period === 'year' ? ', a year' : '')
// "last year's price", "the last PO price".
export const refPriceWords = (rfx: Rfx) => (/^last year$/i.test(rfx.refLabel) ? "last year's price" : `the ${rfx.refLabel} price`)
export const extrasLabel = (rfx: Rfx) => rfx.extrasLabel ?? 'Freight'
export const refMark = (rfx: Rfx) => (/last year/i.test(rfx.refLabel) ? 'LY' : 'REF')

// "all 30 lines", "L27 to L29", or a short list.
export function linesLabel(ids: string[], all: LineItem[]): string {
  if (ids.length === 0) return 'no lines'
  if (ids.length === all.length) return `all ${all.length} lines`
  const idx = ids.map((id) => all.findIndex((l) => l.id === id)).sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const i of idx) {
    const last = runs[runs.length - 1]
    if (last && i === last[1] + 1) last[1] = i
    else runs.push([i, i])
  }
  const parts = runs.map(([a, b]) => (a === b ? all[a].id : b === a + 1 ? `${all[a].id}, ${all[b].id}` : `${all[a].id} to ${all[b].id}`))
  const shown = parts.slice(0, 4).join(', ')
  const text = parts.length > 4 ? `${shown} and more` : shown
  return `${ids.length} line${ids.length > 1 ? 's' : ''} (${text})`
}

interface RuleUse {
  code: RuleCode
  variant: string
  // Free data the rule text is built from once every line under it is known.
  data: Record<string, string | number | null>
}

interface Draft {
  price: number | null
  listPrice: number | null
  basis: Basis
  marks: string[]
  rules: RuleUse[]
  rawText: string | null
  unitText: string | null
  vendorLabel: string | null
  quote: string | null
  steps: string[]
  doubts: { code: DoubtCode; text: string }[]
  match: Cell['match']
  offered: string | null
  attributes: Record<string, CellAttribute>
  addons: Cell['addons']
  tiers: Cell['tiers']
  capacity: number | null
  moq: number | null
}

const blankDraft = (): Draft => ({
  price: null,
  listPrice: null,
  basis: 'quoted',
  marks: [],
  rules: [],
  rawText: null,
  unitText: null,
  vendorLabel: null,
  quote: null,
  steps: [],
  doubts: [],
  match: 'exact',
  offered: null,
  attributes: {},
  addons: [],
  tiers: [],
  capacity: null,
  moq: null,
})

type Discount = VendorSummary['discount']

function fxRate(from: string, to: string): number | null {
  const a = FX_TO_INR[from]
  const b = FX_TO_INR[to]
  return a && b ? a / b : null
}

const curSign = (c: string) => (c === 'INR' ? '₹' : c === 'USD' ? 'USD ' : `${c} `)

function convertItem(item: ExtractedItem, line: LineItem, rfx: Rfx, discount: Discount): Draft {
  const d = blankDraft()
  d.rawText = item.price_text
  d.unitText = item.unit_text
  d.vendorLabel = item.vendor_item_label
  d.quote = item.quote
  d.match = item.match ?? 'exact'
  d.offered = item.offered_item?.trim() ? item.offered_item : null
  const unit = line.unit || 'unit'

  if (item.note) d.doubts.push({ code: 'note', text: `Reader's note: ${item.note}` })
  if (d.match === 'substitute') {
    d.marks.push('sub')
    d.doubts.push({ code: 'substitute', text: `The vendor offered a different item from the one asked for: "${d.offered ?? item.vendor_item_label}".` })
  } else if (d.match === 'unsure') {
    d.doubts.push({ code: 'match_unsure', text: `The reader was not sure this item ("${item.vendor_item_label}") is the one this line asks for.` })
  }

  for (const a of item.attributes ?? []) {
    if (!rfx.attributes.some((x) => x.key === a.key)) continue
    d.attributes[a.key] = { num: a.value_number, text: a.value_text, quote: a.quote, vendorWide: false }
  }

  // Pick the price the RFx quantity falls into, when the vendor quoted breaks by quantity.
  let raw = item.price_value
  const tiers = [...(item.tiers ?? [])].filter((t) => t.price_value > 0).sort((a, b) => a.min_quantity - b.min_quantity)
  let tierPicked: (typeof tiers)[number] | null = null
  if (tiers.length > 0) {
    tierPicked = tiers.filter((t) => t.min_quantity <= line.quantity).pop() ?? tiers[0]
    raw = tierPicked.price_value
  }
  if (raw == null || !Number.isFinite(raw) || raw <= 0) {
    d.doubts.push({ code: 'unreadable', text: `Could not read a usable price from "${item.price_text}".` })
    return d
  }
  const cur = (item.currency || rfx.currency).toUpperCase()
  d.steps.push(`As written: ${tierPicked ? tierPicked.price_text || raw : item.price_text} (${item.unit_text || 'no unit given'})`)
  if (tierPicked) {
    d.rules.push({ code: 'tier', variant: 'qty', data: {} })
    d.marks.push('tier')
    d.steps.push(
      `Quantity break: the RFx quantity is ${line.quantity.toLocaleString('en-IN')}, so the price for ${tierPicked.min_quantity.toLocaleString('en-IN')} and up applies (${curSign(cur)}${raw})`,
    )
  }

  // One conversion, used for the main price, every tier and every add-on. `say` records the steps.
  const convert = (v: number, say: boolean): number | null => {
    let p = v
    if (item.price_basis === 'per_n_units') {
      const n = item.units_per_pack
      if (!n || n <= 0) {
        if (say) d.doubts.push({ code: 'unreadable', text: `Quoted for a pack ("${item.unit_text}") but the pack size is not stated, so no price per ${unit}.` })
        return null
      }
      if (say) {
        d.steps.push(`Per ${unit}: ${curSign(cur)}${p} / ${n} = ${curSign(cur)}${trim(p / n)}`)
        d.rules.push({ code: 'unit', variant: `per_n:${n}`, data: { n, unitText: item.unit_text } })
        d.marks.push(`÷${n}`)
      }
      p = p / n
    } else if (item.price_basis === 'per_measure') {
      const m = (item.measure || '').toLowerCase()
      const amount = line.measures?.[m]
      if (!m || !amount) {
        if (say) d.doubts.push({ code: 'unreadable', text: `Quoted per ${m || 'a measure'} but the RFx does not say how many ${m || 'of it'} one ${unit} holds, so no price per ${unit}.` })
        return null
      }
      if (say) {
        d.steps.push(`Per ${unit}: ${curSign(cur)}${p} per ${m} x ${amount} ${m} per ${unit} (from the RFx) = ${curSign(cur)}${trim(p * amount)}`)
        d.rules.push({ code: 'unit', variant: `per_measure:${m}`, data: { m } })
        d.marks.push(`per ${m}`)
      }
      p = p * amount
    } else if (item.price_basis === 'other') {
      if (say) d.doubts.push({ code: 'unreadable', text: `Unit "${item.unit_text}" is not one this tool can convert to per ${unit}.` })
      return null
    }
    if (cur !== rfx.currency) {
      const rate = fxRate(cur, rfx.currency)
      if (!rate) {
        if (say) d.doubts.push({ code: 'unreadable', text: `Quoted in ${cur || 'an unstated currency'}, which this tool has no rate for.` })
        return null
      }
      if (say) {
        d.steps.push(`Currency: ${cur} ${trim(p)} x ${rate} = ₹${trim(p * rate)} (fixed demo rate, 1 ${cur} = ₹${rate})`)
        d.rules.push({ code: 'currency', variant: cur, data: { cur, rate } })
        d.marks.push(cur)
      }
      p = p * rate
    }
    return p
  }

  const list = convert(raw, true)
  if (list == null) return d
  d.listPrice = r2(list)
  let p = list
  const off = discount && discount.percent > 0 && discount.applied ? discount.percent : 0
  if (discount && discount.percent > 0) {
    if (off) {
      d.steps.push(`Discount: ₹${trim(p)} less ${off}% = ₹${trim(p * (1 - off / 100))}`)
      d.marks.push(`-${off}%`)
      p = p * (1 - off / 100)
    } else {
      d.steps.push(`A ${discount.percent}% discount was found but is not applied${discount.condition ? ', because it has a condition' : ''}. This is the list price.`)
    }
  }
  d.price = r2(p)
  if (d.rules.length > 0 || off) d.basis = 'converted'

  for (const t of tiers) {
    const c = convert(t.price_value, false)
    if (c != null) d.tiers.push({ minQty: t.min_quantity, unitPrice: r2(c * (1 - off / 100)) })
  }
  for (const a of item.addons ?? []) {
    const c = a.price_value > 0 ? convert(a.price_value, false) : null
    if (c != null) d.addons.push({ key: a.key, label: a.label, unitPrice: r2(c), quote: a.quote })
  }

  // Minimum order, stated in the unit the price is quoted for. Turned into RFx units the same way.
  if (item.moq && item.moq > 0) {
    const perPack = item.price_basis === 'per_n_units' ? (item.units_per_pack ?? 1) : 1
    const perMeasure = item.price_basis === 'per_measure' ? (line.measures?.[(item.measure || '').toLowerCase()] ?? 1) : 1
    d.moq = Math.ceil((item.moq * perPack) / perMeasure)
    if (d.moq > line.quantity) {
      d.rules.push({ code: 'moq', variant: 'min', data: {} })
      d.marks.push('MOQ')
      d.steps.push(`Minimum order: ${d.moq.toLocaleString('en-IN')} ${unit}, more than the ${line.quantity.toLocaleString('en-IN')} the RFx needs. The line is costed at the minimum = ₹${trim(d.price * d.moq)}`)
    }
  }
  return d
}

// Price of a cell at a different quantity. Only differs from unitPrice when the vendor quoted tiers.
export function priceAtQuantity(cell: Cell, qty: number): number | null {
  if (cell.unitPrice == null || cell.tiers.length === 0 || cell.basis === 'edited') return cell.unitPrice
  const t = cell.tiers.filter((x) => x.minQty <= qty).pop() ?? cell.tiers[0]
  return t.unitPrice
}

export function buildGrid(rfx: Rfx, replies: Reply[], decisions: Decisions): Grid {
  const lines = rfx.lineItems
  const lineById = new Map(lines.map((l) => [l.id, l]))
  const grid: Grid = { rfx, lines, questionnaire: rfx.questionnaire, vendors: [], cells: {}, rules: [], blockers: [], commonLineIds: [] }
  const drafts: Record<string, Record<string, Draft>> = {}
  const mark = refMark(rfx)

  for (const reply of replies) {
    const ex = reply.extraction
    if (reply.status !== 'done' || !ex) continue
    const dPct = ex.terms.discount?.percent ?? 0
    const condition = ex.terms.discount?.condition ?? null
    const discount: Discount =
      dPct > 0
        ? {
            percent: dPct,
            condition,
            quote: ex.terms.discount.quote,
            // D5: a conditional discount is not applied until the buyer says so.
            applied: decisions.discount[reply.id] ?? !condition,
            decided: reply.id in decisions.discount || !condition,
          }
        : null

    const vd: Record<string, Draft> = {}
    const unmatched: ExtractedItem[] = []
    for (const item of ex.items ?? []) {
      const line = item.rfx_line_id ? lineById.get(item.rfx_line_id) : undefined
      if (!line) {
        unmatched.push(item)
        continue
      }
      if (vd[line.id]) {
        vd[line.id].doubts.push({
          code: 'duplicate',
          text: `A second quoted item was also matched to this line ("${item.vendor_item_label}", ${item.price_text}). The first one is shown.`,
        })
        continue
      }
      vd[line.id] = convertItem(item, line, rfx, discount)
      if (reply.docText && !quoteFound(reply.docText, item.quote)) {
        vd[line.id].doubts.push({
          code: 'quote_not_found',
          text: 'The source quote the reader gave for this price does not appear word for word in the document text. Check the price against the document.',
        })
      }
    }

    // References such as "rest same as last year" or "current rates plus 6%".
    // Resolved from the buyer's own reference prices, never guessed.
    const notes: string[] = [...(ex.document_notes ?? [])]
    for (const ref of ex.references ?? []) {
      if (ref.kind !== 'previous_price') {
        notes.push(`The vendor refers to something this tool did not resolve: "${ref.quote}"`)
        continue
      }
      const skip = new Set(ref.excluded_line_ids ?? [])
      const targets = (ref.scope === 'all_lines_not_otherwise_quoted' ? lines.filter((l) => !vd[l.id]).map((l) => l.id) : ref.line_ids ?? []).filter((id) => !skip.has(id))
      const adj = ref.adjustment_percent ?? 0
      for (const id of targets) {
        const line = lineById.get(id)
        if (!line || vd[id]) continue
        const d = blankDraft()
        d.basis = 'assumed'
        d.quote = ref.quote
        if (line.refPrice == null) {
          d.doubts.push({ code: 'unreadable', text: `The vendor pointed to the ${rfx.refLabel} price but there is none on file for this line.` })
        } else {
          let p = line.refPrice
          d.steps.push(`The vendor did not write a price for this line. They wrote: "${ref.quote}"`)
          d.steps.push(`Price on file (${rfx.refLabel}) for ${line.id}: ₹${line.refPrice}`)
          if (adj) {
            d.steps.push(`Adjustment the vendor stated: ${adj > 0 ? 'plus' : 'less'} ${Math.abs(adj)}% = ₹${trim(p * (1 + adj / 100))}`)
            p = p * (1 + adj / 100)
          }
          d.listPrice = r2(p)
          const off = discount && discount.percent > 0 && discount.applied ? discount.percent : 0
          if (off) {
            d.steps.push(`Discount: ₹${trim(p)} less ${off}% = ₹${trim(p * (1 - off / 100))}`)
            d.marks.push(`-${off}%`)
            p = p * (1 - off / 100)
          }
          d.price = r2(p)
          d.marks.unshift(mark)
          d.rules.push({ code: 'reference', variant: String(adj), data: { adj, quote: ref.quote } })
        }
        if (ref.note) d.doubts.push({ code: 'note', text: `Reader's note: ${ref.note}` })
        vd[id] = d
      }
    }

    // A vendor-wide statement ("3 weeks on all items") fills the attribute on every line that has none.
    const wide: { key: string; quote: string; text: string; lineIds: string[] }[] = []
    for (const a of ex.vendor_attributes ?? []) {
      const def = rfx.attributes.find((x) => x.key === a.key)
      if (!def) continue
      const hit: string[] = []
      for (const l of lines) {
        const d = vd[l.id]
        if (!d || d.attributes[a.key]) continue
        d.attributes[a.key] = { num: a.value_number, text: a.value_text, quote: a.quote, vendorWide: true }
        hit.push(l.id)
      }
      if (hit.length) wide.push({ key: a.key, quote: a.quote, text: `${def.label}: ${a.value_number ?? a.value_text}${a.value_number != null && def.unit ? ` ${def.unit}` : ''}`, lineIds: hit })
    }
    // Supply limits, from an attribute the RFx marks as a capacity.
    for (const def of rfx.attributes.filter((x) => x.capacity)) {
      for (const l of lines) {
        const d = vd[l.id]
        const n = d?.attributes[def.key]?.num
        if (d && n != null && n >= 0) d.capacity = Math.round(n * (rfx.period === 'year' ? def.capacity!.periodsPerYear : 1))
      }
    }
    drafts[reply.id] = vd

    const answers: VendorSummary['answers'] = {}
    for (const a of ex.answers ?? []) answers[a.question_id] = a
    const ic = ex.terms.index_clause
    grid.vendors.push({
      replyId: reply.id,
      name: reply.vendorName,
      fileName: reply.fileName,
      readBy: [reply.provider, reply.model].filter(Boolean).join(' / '),
      linesQuoted: 0,
      totalLines: lines.length,
      counts: { clean: 0, look: 0, noPrice: 0, notQuoted: 0, underOpenRule: 0 },
      costQuoted: 0,
      likeForLike: null,
      provisional: false,
      freight: ex.terms.freight?.status ?? 'not_stated',
      gst: ex.terms.gst?.status ?? 'not_stated',
      discount,
      indexClause: ic?.index_name && ic.percent_per_unit != null ? { indexName: ic.index_name, percentPerUnit: ic.percent_per_unit, quote: ic.quote } : null,
      validity: ex.terms.validity?.text ?? null,
      payment: ex.terms.payment?.text ?? null,
      gate: gateStatus(rfx, answers),
      answers,
      unmatched,
      notes,
    })

    // ---- Rules for this vendor ----
    const v = grid.vendors[grid.vendors.length - 1]
    const byRule = new Map<string, { use: RuleUse; lineIds: string[] }>()
    for (const l of lines) {
      for (const use of vd[l.id]?.rules ?? []) {
        const id = `${reply.id}|${use.code}|${use.variant}`
        const g = byRule.get(id) ?? { use, lineIds: [] }
        g.lineIds.push(l.id)
        byRule.set(id, g)
      }
    }
    const costOf = (ids: string[]) => r2(ids.reduce((s, id) => s + (vd[id]?.price ?? 0) * (lineById.get(id)?.quantity ?? 0), 0))
    for (const [id, g] of byRule) {
      const where = linesLabel(g.lineIds, lines)
      const unit = lines[0]?.unit || 'unit'
      let title = ''
      let text = ''
      let quote: string | null = null
      const dd = g.use.data
      if (g.use.code === 'unit' && g.use.variant.startsWith('per_n')) {
        title = `Quoted per ${dd.n}, converted to per ${unit}`
        text = `Prices on ${where} are written "${dd.unitText}". Code divided each by ${dd.n} to get a price per ${unit}.`
      } else if (g.use.code === 'unit') {
        const amounts = g.lineIds.map((x) => lineById.get(x)!.measures[String(dd.m)])
        const lo = Math.min(...amounts)
        const hi = Math.max(...amounts)
        title = `Quoted per ${dd.m}, converted to per ${unit}`
        text = `Prices on ${where} are per ${dd.m}. Code multiplied each by that line's ${dd.m} per ${unit} from the RFx (${lo === hi ? lo : `${lo} to ${hi}`} ${dd.m}).`
      } else if (g.use.code === 'currency') {
        title = `Quoted in ${dd.cur}, converted to ${rfx.currency}`
        text = `Prices on ${where} are in ${dd.cur}. Converted at a fixed 1 ${dd.cur} = ₹${dd.rate}, which is not a live rate.`
      } else if (g.use.code === 'reference') {
        const adj = Number(dd.adj)
        title = adj ? `Filled from ${refPriceWords(rfx)}, ${adj > 0 ? 'plus' : 'less'} ${Math.abs(adj)}%` : `Filled from ${refPriceWords(rfx)}`
        text = `The vendor wrote no price for ${where}. Code used your ${rfx.refLabel} price on file${adj ? ` and applied the ${Math.abs(adj)}% the vendor stated` : ''}. These are not numbers the vendor wrote.`
        quote = String(dd.quote ?? '')
      } else if (g.use.code === 'tier') {
        title = 'Price breaks by quantity'
        text = `The vendor quoted price breaks by quantity on ${where}. Code picked the break that fits each line's RFx quantity.`
      } else if (g.use.code === 'moq') {
        title = 'Minimum order above what you need'
        text = `On ${where} the vendor's minimum order is more than the RFx quantity. Code costs each of those lines at the minimum, so you pay for units you did not ask for.`
      }
      // For a minimum order the amount is what the minimums add, not the whole line.
      const amount = g.use.code === 'moq' ? r2(g.lineIds.reduce((s, x) => s + (vd[x].price ?? 0) * Math.max(0, (vd[x].moq ?? 0) - lineById.get(x)!.quantity), 0)) : costOf(g.lineIds)
      grid.rules.push({ id, replyId: reply.id, vendorName: v.name, code: g.use.code, title, text, quote, lineIds: g.lineIds, amount, accepted: !!decisions.rules[id] })
    }
    for (const w of wide) {
      const id = `${reply.id}|vendor_attribute|${w.key}`
      grid.rules.push({
        id,
        replyId: reply.id,
        vendorName: v.name,
        code: 'vendor_attribute',
        title: `One statement applied to ${w.lineIds.length === lines.length ? 'every line' : `${w.lineIds.length} lines`}`,
        text: `The vendor made one statement for the whole quote. Code recorded it on ${linesLabel(w.lineIds, lines)} as ${w.text}.`,
        quote: w.quote,
        lineIds: w.lineIds,
        amount: 0,
        // Changes no price, so it is recorded and shown but is not something the buyer has to accept.
        accepted: true,
      })
    }
    if (discount) {
      const id = `${reply.id}|discount|${discount.percent}`
      const priced = lines.filter((l) => vd[l.id]?.listPrice != null).map((l) => l.id)
      const listTotal = r2(priced.reduce((s, x) => s + (vd[x].listPrice ?? 0) * lineById.get(x)!.quantity, 0))
      const discountedTotal = r2(listTotal * (1 - discount.percent / 100))
      const base = { id, replyId: reply.id, vendorName: v.name, code: 'discount' as const, quote: discount.quote, lineIds: priced, amount: r2(listTotal - discountedTotal) }
      if (discount.condition) {
        grid.rules.push({
          ...base,
          title: `${discount.percent}% discount with a condition`,
          text: `The vendor offers ${discount.percent}% off, but only on a condition: ${discount.condition}. Prices show ${discount.applied ? 'the discount applied' : 'the list price'} until you choose.`,
          accepted: discount.decided,
          choice: { percent: discount.percent, condition: discount.condition, applied: discount.applied, decided: discount.decided, listTotal, discountedTotal },
        })
      } else {
        grid.rules.push({
          ...base,
          title: `${discount.percent}% discount applied`,
          text: `The vendor states ${discount.percent}% off with no condition. Code applied it to ${linesLabel(priced, lines)}.`,
          accepted: !!decisions.rules[id],
        })
      }
      for (const x of priced) vd[x].rules.push({ code: 'discount', variant: String(discount.percent), data: {} })
    }
  }

  // Outlier check: against the line's median across vendors.
  for (const line of lines) {
    const prices = Object.values(drafts)
      .map((vd) => vd[line.id]?.price)
      .filter((p): p is number => p != null)
    const med = prices.length >= 3 ? median(prices) : null
    for (const vd of Object.values(drafts)) {
      const d = vd[line.id]
      if (!d || d.price == null) continue
      if (med != null && (d.price > med * OUTLIER_FACTOR || d.price < med / OUTLIER_FACTOR)) {
        d.doubts.push({
          code: 'outlier',
          text: `₹${d.price} is far from the median of ₹${r2(med)} across vendors for this line (more than ${OUTLIER_FACTOR}x away). Likely a unit or reading problem.`,
        })
      }
      // Second net: catches a wrong unit that lands inside 3x, by comparing with the buyer's own reference price.
      // Uses the list price, so a discount the buyer switched on does not trip it.
      const lp = d.listPrice ?? d.price
      if (d.basis !== 'assumed' && line.refPrice && Math.abs(lp - line.refPrice) / line.refPrice > OFF_REFERENCE_SHARE) {
        const pc = Math.round(((lp - line.refPrice) / line.refPrice) * 100)
        d.doubts.push({
          code: 'off_reference',
          text: `₹${lp} is ${Math.abs(pc)}% ${pc > 0 ? 'above' : 'below'} your ${rfx.refLabel} price of ₹${line.refPrice} for this line (more than ${Math.round(OFF_REFERENCE_SHARE * 100)}% away). Check the unit and the digits.`,
        })
      }
    }
  }

  // Apply buyer decisions and settle cells.
  const ruleAccepted = new Map(grid.rules.map((r) => [r.id, r.accepted]))
  for (const v of grid.vendors) {
    const row: Record<string, Cell> = {}
    for (const line of lines) {
      const d = drafts[v.replyId][line.id]
      const k = cellKey(v.replyId, line.id)
      const override = decisions.overrides[k]
      const confirmed = new Set(decisions.doubts[k] ?? [])
      const base = {
        replyId: v.replyId,
        lineId: line.id,
        rawText: d?.rawText ?? null,
        unitText: d?.unitText ?? null,
        vendorLabel: d?.vendorLabel ?? null,
        quote: d?.quote ?? null,
        match: d?.match ?? 'exact',
        offered: d?.offered ?? null,
        attributes: d?.attributes ?? {},
        addons: d?.addons ?? [],
        tiers: d?.tiers ?? [],
        capacity: d?.capacity ?? null,
        moq: d?.moq ?? null,
      }
      let cell: Cell
      if (override != null) {
        cell = {
          ...base,
          basis: 'edited',
          check: 'none',
          unitPrice: override,
          lineCost: r2(override * Math.max(line.quantity, base.moq ?? 0)),
          marks: ['edited'],
          ruleIds: [],
          ruleOpen: false,
          steps: [...(d?.steps ?? []), `You typed ₹${override} per ${line.unit}. This replaces the extracted value.`],
          doubts: (d?.doubts ?? []).map((x) => ({ ...x, confirmed: true })),
        }
      } else if (!d) {
        cell = { ...base, basis: null, check: 'not_quoted', unitPrice: null, lineCost: null, marks: [], ruleIds: [], ruleOpen: false, steps: [], doubts: [] }
      } else {
        const doubts: Doubt[] = d.doubts.map((x) => ({ ...x, confirmed: confirmed.has(x.code) }))
        const ruleIds = d.rules.map((u) => `${v.replyId}|${u.code}|${u.variant}`)
        cell = {
          ...base,
          basis: d.basis,
          // No usable price stays open even if the buyer clicked confirm: there is nothing to confirm.
          check: d.price == null ? 'no_price' : doubts.some((x) => !x.confirmed) ? 'look' : 'none',
          unitPrice: d.price,
          lineCost: d.price == null ? null : r2(d.price * Math.max(line.quantity, d.moq ?? 0)),
          marks: d.marks,
          ruleIds,
          ruleOpen: ruleIds.some((id) => ruleAccepted.get(id) === false),
          steps: d.steps,
          doubts,
        }
      }
      row[line.id] = cell
      if (cell.check === 'not_quoted') v.counts.notQuoted++
      else if (cell.check === 'no_price') v.counts.noPrice++
      else if (cell.check === 'look') v.counts.look++
      else v.counts.clean++
      if (cell.unitPrice != null) {
        v.linesQuoted++
        v.costQuoted += cell.lineCost ?? 0
        if (cell.ruleOpen) v.counts.underOpenRule++
        if (isUnconfirmed(cell)) v.provisional = true
      }
    }
    v.costQuoted = r2(v.costQuoted)
    grid.cells[v.replyId] = row
  }

  // Like-for-like: only the lines every vendor priced.
  grid.commonLineIds = grid.vendors.length ? lines.filter((l) => grid.vendors.every((v) => grid.cells[v.replyId][l.id].unitPrice != null)).map((l) => l.id) : []
  for (const v of grid.vendors) {
    v.likeForLike = grid.commonLineIds.length ? r2(grid.commonLineIds.reduce((s, id) => s + (grid.cells[v.replyId][id].lineCost ?? 0), 0)) : null
    grid.blockers.push(...blockersFor(v, grid, decisions))
  }
  return grid
}

// A price the buyer has not signed off: under an unaccepted rule, or with an open doubt.
export const isUnconfirmed = (c: Cell) => c.unitPrice != null && (c.ruleOpen || c.check === 'look')

function blockersFor(v: VendorSummary, grid: Grid, decisions: Decisions): Blocker[] {
  const out: Blocker[] = []
  const add = (kind: Blocker['kind'], title: string, text: string, amount: number) => {
    const id = `${v.replyId}|${kind}`
    out.push({ id, replyId: v.replyId, vendorName: v.name, kind, title, text, amount, noted: !!decisions.noted[id] })
  }
  const gates = grid.questionnaire.filter((q) => q.gate)
  if (gates.length > 0) {
    if (v.gate === 'fail') {
      const failed = gates.filter((q) => v.answers[q.id]?.meets_requirement === 'no')
      add('gate', 'Failed the quality gate', failed.map((q) => `${q.id}: "${v.answers[q.id]?.answer ?? ''}"`).join(' '), v.costQuoted)
    } else if (v.gate === 'not_answered') {
      add('no_answers', 'Did not answer the questionnaire', 'Nothing in this reply answers the quality-gate questions, so this vendor has not cleared the gate.', v.costQuoted)
    } else if (v.gate === 'unclear') {
      const open = gates.filter((q) => v.answers[q.id]?.meets_requirement !== 'yes')
      add('gate', 'A quality-gate answer is unclear or missing', `Check ${open.map((q) => q.id).join(', ')} in the questionnaire tab.`, v.costQuoted)
    }
  }
  const ex = extrasLabel(grid.rfx)
  if (v.freight === 'extra') add('freight', `${ex} not in the price`, `These prices leave ${ex.toLowerCase()} out, so they are not on the same basis as vendors who include it.`, v.costQuoted)
  if (v.freight === 'not_stated') add('freight', `${ex} not stated`, `The reply does not say whether ${ex.toLowerCase()} is in the price.`, v.costQuoted)
  const missing = grid.lines.filter((l) => grid.cells[v.replyId][l.id].unitPrice == null)
  if (missing.length > 0) {
    const ref = r2(missing.reduce((s, l) => s + (l.refPrice ?? 0) * l.quantity, 0))
    add('lines', `Priced ${v.linesQuoted} of ${v.totalLines} lines`, `No usable price for ${linesLabel(missing.map((l) => l.id), grid.lines)}. A total for this vendor leaves those out.`, ref)
  }
  if (v.unmatched.length > 0) {
    add('unmatched', `${v.unmatched.length} quoted item${v.unmatched.length > 1 ? 's' : ''} not matched to a line`, v.unmatched.map((u) => `"${u.vendor_item_label}" at ${u.price_text}`).join('; '), 0)
  }
  return out
}

function gateStatus(rfx: Rfx, answers: VendorSummary['answers']): GateStatus {
  const gates = rfx.questionnaire.filter((q) => q.gate)
  if (gates.length === 0) return 'pass'
  const got = gates.map((q) => answers[q.id])
  if (got.every((a) => !a || !a.answered)) return 'not_answered'
  if (got.some((a) => a?.answered && a.meets_requirement === 'no')) return 'fail'
  if (got.every((a) => a?.answered && a.meets_requirement === 'yes')) return 'pass'
  return 'unclear'
}

// Compare on letters and digits only, so spacing and punctuation differences do not matter.
const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
export function quoteFound(docText: string, quote: string | null): boolean {
  if (!quote) return false
  const q = squash(quote)
  return q.length > 0 && squash(docText).includes(q)
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ---- The "To confirm" list ----
export interface DoubtCard {
  replyId: string
  vendorName: string
  lineId: string
  cell: Cell
  amount: number
}

export function doubtCards(grid: Grid): DoubtCard[] {
  const out: DoubtCard[] = []
  for (const v of grid.vendors) {
    for (const l of grid.lines) {
      const c = grid.cells[v.replyId][l.id]
      if (c.check !== 'look' && c.check !== 'no_price') continue
      out.push({ replyId: v.replyId, vendorName: v.name, lineId: l.id, cell: c, amount: c.lineCost ?? r2((l.refPrice ?? 0) * l.quantity) })
    }
  }
  return out.sort((a, b) => b.amount - a.amount)
}

export const openRules = (grid: Grid) => grid.rules.filter((r) => !r.accepted).sort((a, b) => b.amount - a.amount)
export const toConfirmCount = (grid: Grid) => openRules(grid).length + doubtCards(grid).length

// Vendors whose prices can be compared like for like: cleared the gate, and on the freight basis
// most gate-cleared vendors use. The "lowest" marker in the grid is worked out among these only.
export function comparableVendorIds(grid: Grid): Set<string> {
  const passed = grid.vendors.filter((v) => v.gate === 'pass')
  if (passed.length === 0) return new Set()
  const tally = new Map<string, number>()
  for (const v of passed) tally.set(v.freight, (tally.get(v.freight) ?? 0) + 1)
  const basis = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]
  return new Set(passed.filter((v) => v.freight === basis).map((v) => v.replyId))
}

// A vendor's name without the company suffix, for column heads.
export const shortName = (name: string) => name.replace(/[, ]+(Pvt\.? Ltd\.?|Private Limited|LLP|Ltd\.?|Limited|Inc\.?)$/i, '')

// Like-for-like cost of the buyer's own reference prices, on the lines every vendor priced.
export const referenceTotal = (grid: Grid, lineIds = grid.commonLineIds) => {
  const ids = new Set(lineIds)
  return r2(grid.lines.filter((l) => ids.has(l.id)).reduce((s, l) => s + (l.refPrice ?? 0) * l.quantity, 0))
}

// Where a vendor stands, in a few words. The same words are used in the vendor table and the grid head.
export function standing(grid: Grid, v: VendorSummary): { short: string; long: string; tone: 'none' | 'need' | 'stop' } {
  const gates = grid.questionnaire.some((q) => q.gate)
  const ex = extrasLabel(grid.rfx).toLowerCase()
  const failed = grid.questionnaire.filter((q) => q.gate && v.answers[q.id]?.meets_requirement === 'no').map((q) => q.id)
  const gate = !gates ? '' : v.gate === 'pass' ? 'Gate passed' : v.gate === 'fail' ? `Failed gate${failed.length ? `: ${failed.join(', ')}` : ''}` : v.gate === 'unclear' ? 'Gate unclear' : 'No questionnaire'
  const short = v.linesQuoted < v.totalLines
  const second = short ? `${v.linesQuoted} of ${v.totalLines} lines` : v.freight === 'included' ? `${ex} in` : v.freight === 'extra' ? `${ex} extra` : `${ex} not stated`
  // Pricing only part of the list stands out only when some vendor priced all of it.
  const partial = short && (v.linesQuoted === 0 || grid.vendors.some((x) => x.linesQuoted === x.totalLines))
  const tone = v.gate === 'fail' ? 'stop' : (gates && v.gate !== 'pass') || partial || v.freight !== 'included' ? 'need' : 'none'
  const gateOk = !gates || v.gate === 'pass'
  return { short: !gateOk ? gate.replace(/:.*/, '') : tone === 'need' ? second.charAt(0).toUpperCase() + second.slice(1) : gate || second, long: v.gate === 'fail' ? gate : [gate, second].filter(Boolean).join(' · '), tone }
}

export const DOUBT_TITLES: Record<DoubtCode, string> = {
  outlier: 'Far from other vendors',
  off_reference: 'Far from your reference price',
  note: 'Reader left a note',
  duplicate: 'Two items matched one line',
  unreadable: 'No usable price',
  quote_not_found: 'Source quote not found in the document',
  substitute: 'Different item offered',
  match_unsure: 'Match is uncertain',
}
