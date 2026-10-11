import type { Llm, Part } from './llm/index.ts'
import { PlainError } from './llm/index.ts'
import type { ExtractedAttribute, ExtractedItem, Extraction, Rfx, TermStatus } from './types.ts'

// One model call per vendor document. The model reads and matches. It does not convert
// units or currency, apply discounts, pick a quantity tier or fill gaps. Code does that
// in normalize.ts.

const str = { type: 'string' }
const num = { type: 'number' }
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const list = (items: unknown) => ({ type: 'array', items })
// The schema is compiled into a grammar by the provider, and a grammar that is too large is
// rejected ("The compiled grammar is too large"). The first Part 2 schema hit that limit. So this
// one is kept flat and small on purpose:
// - No nullable or union types. "Nothing" is an empty string or 0, and toExtraction() below turns
//   those back into null.
// - No lists inside list items. Price breaks, add-ons and attributes are one flat `details` list,
//   each entry pointing at its line, instead of three lists nested in every item.
// Every property is required and no extra properties are allowed, which is also what OpenAI's
// strict mode needs.
const termStatus = { type: 'string', enum: ['included', 'extra', 'not_stated'] }

export const EXTRACTION_SCHEMA = obj({
  vendor_name: str,
  items: list(
    obj({
      rfx_line_id: str,
      vendor_item_label: str,
      price_text: str,
      price_value: num,
      unit_text: str,
      price_basis: { type: 'string', enum: ['per_unit', 'per_n_units', 'per_measure', 'other'] },
      units_per_pack: num,
      measure: str,
      currency: str,
      match: { type: 'string', enum: ['exact', 'substitute', 'unsure'] },
      offered_item: str,
      quote: str,
      note: str,
    }),
  ),
  details: list(
    obj({
      kind: { type: 'string', enum: ['price_break', 'addon', 'attribute', 'min_order'] },
      rfx_line_id: str,
      key: str,
      label: str,
      number: num,
      has_number: { type: 'boolean' },
      min_quantity: num,
      quote: str,
    }),
  ),
  references: list(
    obj({
      kind: { type: 'string', enum: ['previous_price', 'other'] },
      scope: { type: 'string', enum: ['all_lines_not_otherwise_quoted', 'listed_lines'] },
      line_ids: list(str),
      excluded_line_ids: list(str),
      adjustment_percent: num,
      quote: str,
      note: str,
    }),
  ),
  answers: list(
    obj({
      question_id: str,
      answered: { type: 'boolean' },
      answer: str,
      meets_requirement: { type: 'string', enum: ['yes', 'no', 'unclear', 'not_applicable'] },
      quote: str,
    }),
  ),
  terms: obj({
    freight_status: termStatus,
    freight_quote: str,
    gst_status: termStatus,
    gst_quote: str,
    discount_percent: num,
    discount_condition: str,
    discount_quote: str,
    validity: str,
    payment: str,
    index_name: str,
    index_percent_per_unit: num,
    index_quote: str,
  }),
  document_notes: list(str),
})

// What the model returns, in the flat shape above.
export interface RawExtraction {
  vendor_name: string
  items: {
    rfx_line_id: string
    vendor_item_label: string
    price_text: string
    price_value: number
    unit_text: string
    price_basis: ExtractedItem['price_basis']
    units_per_pack: number
    measure: string
    currency: string
    match: ExtractedItem['match']
    offered_item: string
    quote: string
    note: string
  }[]
  details: { kind: 'price_break' | 'addon' | 'attribute' | 'min_order'; rfx_line_id: string; key: string; label: string; number: number; has_number: boolean; min_quantity: number; quote: string }[]
  references: { kind: 'previous_price' | 'other'; scope: 'all_lines_not_otherwise_quoted' | 'listed_lines'; line_ids: string[]; excluded_line_ids: string[]; adjustment_percent: number; quote: string; note: string }[]
  answers: { question_id: string; answered: boolean; answer: string; meets_requirement: Extraction['answers'][number]['meets_requirement']; quote: string }[]
  terms: {
    freight_status: TermStatus
    freight_quote: string
    gst_status: TermStatus
    gst_quote: string
    discount_percent: number
    discount_condition: string
    discount_quote: string
    validity: string
    payment: string
    index_name: string
    index_percent_per_unit: number
    index_quote: string
  }
  document_notes: string[]
}

const SYSTEM = `You read one vendor's reply to a purchase RFx and record what it says, for a buyer who will check your work against the document.

Your job is to read and to match. You never calculate. Code downstream converts units and currency, applies discounts and adjustments, picks quantity breaks and fills references. If you convert or compute anything, the result will be wrong twice.

Items
- Emit one item for each RFx line the vendor gives a price for. Match the vendor's item to an RFx line by what the item is (its specification, size, type, route), not by position. Vendors use their own item codes, wording and order.
- If one statement prices a group of lines (for example one rate for a whole category or region), emit one item per RFx line it covers, each with the same quote.
- If you cannot match an item to exactly one RFx line with confidence, set rfx_line_id to an empty string and say why in note.
- Do not emit an item for a line the vendor did not price. Never invent or infer a price.
- price_text: the price exactly as written. price_value: that same number as written, with no conversion (for "640.00 per 100 Nos" the value is 640). Use 0 only when you cannot read a price at all.
- unit_text: the unit as the vendor wrote it. price_basis:
  - per_unit: priced per one RFx unit (the RFx line list gives each line's unit).
  - per_n_units: priced per pack, box, bundle, dozen or hundred of N RFx units. Put N in units_per_pack.
  - per_measure: priced per kg, per km, per tonne or another measure. Put the measure in measure as a lower-case singular word that matches the RFx line's measures (kg, km, tonne).
  - other: anything else.
  units_per_pack is 0 unless the basis is per_n_units. measure is an empty string unless the basis is per_measure.
- Be careful with words like "per box" or "per pack". If the document says a box or pack holds several units for some items, those items are per_n_units.
- currency: the ISO code of the currency stated for that price (INR, USD, EUR). Use the RFx currency when the document clearly prices in it. Use an empty string if you cannot tell.
- match: exact when the offered item is the item the RFx line asks for. substitute when the vendor offers a different model, grade or specification in its place (an "equivalent", an older or lower specification). unsure when you cannot tell. offered_item: for substitute or unsure, the vendor's own description of what they offer, otherwise an empty string.
- quote: the shortest verbatim text from the document that shows this price (for a table row, the row). Under 200 characters. Copy it, do not paraphrase.
- note: an empty string in the normal case. Use it only for something the buyer must check by eye: a digit you could not read with confidence (say which, and give your best reading as the value), an ambiguous unit, two statements that conflict. Do not use note to repeat the unit, the currency, a substitute or a discount, those have their own fields.

References
- If the vendor points to a price without stating it (for example "rest same as last year", "current contract rates plus 6%", "10% off our last PO rates"), record it under references with kind previous_price. Do not look up or compute the value.
- scope: all_lines_not_otherwise_quoted for wording like "rest" or "all others", otherwise listed_lines with the RFx line ids it covers. If the vendor excludes some lines ("we don't serve the south lanes"), list those RFx line ids in excluded_line_ids.
- adjustment_percent: the percent the vendor applies to that earlier price, signed (plus 6% is 6, 10% off is -10). 0 when there is none.

Details (one flat list for the whole document, each entry pointing at an RFx line by rfx_line_id)
- kind price_break: only when the vendor gives different prices by quantity for an item. One entry per break: min_quantity is the lowest quantity that break applies to (1 for the first), number is the price as written, has_number is true. Set the item's own price_text and price_value to the first break. Emit none when an item has one price.
- kind addon: an optional extra the vendor prices separately for an item (for example an extended warranty). key is a short stable snake_case name, the same for every item and vendor (for a three-year warranty use warranty_3y). label is a few plain words. number is the add-on price as written, has_number is true. Never add it into the item's price_value.
- kind min_order: only when the vendor states a minimum order quantity for an item. number is that minimum as written, counted in the same unit the item's price is quoted for (boxes if the price is per box), has_number is true. label is the vendor's own words.
- kind attribute: what the vendor states for an attribute the RFx asks for (listed below). key is the attribute key. number is the value in the unit the RFx asks for (turn "3 weeks" into 21 only when the RFx unit is days and the statement is that plain) with has_number true, or has_number false when it is not a number. label is the vendor's own words.
- When the vendor states an attribute once for the whole quote ("delivery 3 weeks on all items"), emit it once with rfx_line_id as an empty string instead of once per line.
- Fields that do not apply to an entry are an empty string or 0. quote is the verbatim text the entry comes from.

Questionnaire
- Return one answer entry per RFx question. answered is false when the document says nothing on it.
- For questions marked as quality gate, set meets_requirement from the vendor's own words only: yes, no, or unclear. Expired, pending, planned or partial is not yes. For other questions use not_applicable.
- quote is the verbatim text you based the answer on.

Terms
- freight_status and gst_status: included, extra or not_stated, each with its verbatim quote. "Ex-works", "ex-factory", "freight extra" and "tolls extra" style wording means extra. "Delivered", "F.O.R. destination" and "freight included" mean included.
- discount_percent, discount_condition, discount_quote: a discount on the whole quote. Look in footnotes and small print. discount_percent is 0 when there is none. Do not apply it to the prices.
- index_name, index_percent_per_unit, index_quote: when prices are tied to an index such as a diesel price. index_name is a short lower-case name (diesel). index_percent_per_unit is the percent the price moves for a one-unit rise in the index, as the vendor states it. Empty string and 0 when there is none.
- For every text field, use an empty string when there is nothing to record.
- document_notes: anything else a buyer should know before trusting this document, for example that the image was hard to read or that a vehicle size or model was not stated. Empty if nothing.`

function rfxBrief(rfx: Rfx): string {
  const lines = rfx.lineItems
    .map((l) => {
      const m = Object.entries(l.measures ?? {})
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')
      return `${l.id} | ${l.category} | ${l.description} | RFx unit: per ${l.unit}${m ? ` | one ${l.unit} holds: ${m}` : ''} | quantity: ${l.quantity}`
    })
    .join('\n')
  const qs = rfx.questionnaire.map((q) => `${q.id}${q.gate ? ' [quality gate]' : ''}: ${q.text}`).join('\n')
  const attrs = rfx.attributes.map((a) => `${a.key}: ${a.label}${a.unit ? ` (in ${a.unit})` : ''}`).join('\n')
  const extras = rfx.extrasLabel ? `\nFor this RFx, use the freight term to record whether ${rfx.extrasLabel.toLowerCase()} are included in the price, extra, or not stated.` : ''
  return `RFx ${rfx.id}: ${rfx.title}\nBuyer: ${rfx.buyer}\nRFx currency: ${rfx.currency}${extras}\n\nRFx line items:\n${lines}\n\nAttributes the RFx asks for on each line:\n${attrs || '(none)'}\n\nQuestionnaire:\n${qs || '(none)'}`
}

export async function extractDocument(llm: Llm, rfx: Rfx, parts: Part[], fileName: string): Promise<Extraction> {
  const raw = (await llm.provider.extract({
    key: llm.key,
    model: llm.model,
    system: SYSTEM,
    parts,
    instruction: `The vendor's reply is above (file name: ${fileName}).\n\n${rfxBrief(rfx)}\n\nRecord what this vendor quoted and answered.`,
    schema: EXTRACTION_SCHEMA,
  })) as RawExtraction
  if (!raw || !Array.isArray(raw.items) || !raw.terms) throw new PlainError('The model returned a result in an unexpected shape. Try re-running this document.')
  return toExtraction(raw)
}

const nn = (v: string | null | undefined): string | null => (v && v.trim() ? v : null)
const pos = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null)

// Turn the flat reading back into the shape the rest of the app uses: blanks and zeros become
// null, and each detail is attached to its line.
export function toExtraction(e: RawExtraction): Extraction {
  const details = e.details ?? []
  const attribute = (d: RawExtraction['details'][number]): ExtractedAttribute => ({ key: d.key, value_number: d.has_number ? d.number : null, value_text: d.label || (d.has_number ? String(d.number) : ''), quote: d.quote })
  const t = e.terms
  return {
    vendor_name: nn(e.vendor_name),
    items: e.items.map((i) => {
      const mine = i.rfx_line_id ? details.filter((d) => d.rfx_line_id === i.rfx_line_id) : []
      return {
        ...i,
        rfx_line_id: nn(i.rfx_line_id),
        price_value: pos(i.price_value),
        units_per_pack: pos(i.units_per_pack),
        note: nn(i.note),
        tiers: mine.filter((d) => d.kind === 'price_break' && d.number > 0).map((d) => ({ min_quantity: d.min_quantity > 0 ? d.min_quantity : 1, price_value: d.number, price_text: String(d.number) })),
        addons: mine.filter((d) => d.kind === 'addon' && d.number > 0).map((d) => ({ key: d.key, label: d.label || d.key, price_value: d.number, price_text: String(d.number), quote: d.quote })),
        attributes: mine.filter((d) => d.kind === 'attribute').map(attribute),
        moq: mine.find((d) => d.kind === 'min_order' && d.number > 0)?.number ?? null,
      }
    }),
    references: (e.references ?? []).map((r) => ({ ...r, adjustment_percent: r.adjustment_percent ? r.adjustment_percent : null, note: nn(r.note) })),
    vendor_attributes: details.filter((d) => d.kind === 'attribute' && !d.rfx_line_id).map(attribute),
    answers: (e.answers ?? []).map((a) => ({ ...a, answer: nn(a.answer), quote: nn(a.quote) })),
    terms: {
      freight: { status: t.freight_status, quote: nn(t.freight_quote) },
      gst: { status: t.gst_status, quote: nn(t.gst_quote) },
      discount: { percent: pos(t.discount_percent), condition: nn(t.discount_condition), quote: nn(t.discount_quote) },
      validity: { text: nn(t.validity), quote: null },
      payment: { text: nn(t.payment), quote: null },
      index_clause: { index_name: nn(t.index_name), percent_per_unit: t.index_percent_per_unit ? t.index_percent_per_unit : null, quote: nn(t.index_quote) },
    },
    document_notes: e.document_notes ?? [],
  }
}
