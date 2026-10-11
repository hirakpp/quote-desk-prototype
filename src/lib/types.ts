// ---- RFx ----
// A line attribute the RFx asks vendors for, beyond price (lead time, warranty, transit days).
export interface AttributeDef {
  key: string
  label: string
  unit?: string
  better: 'lower' | 'higher' | 'none'
  // Set when the attribute is a supply limit in line units. periodsPerYear turns
  // "trucks a month" into a yearly limit that can be compared with the line quantity.
  capacity?: { periodsPerYear: number }
}

export interface LineItem {
  id: string
  description: string
  // Short size or spec, shown in its own column.
  spec?: string
  category: string
  // How much of a measure one unit holds, for example { kg: 0.095 } or { km: 1420, tonne: 9 }.
  measures: Record<string, number>
  quantity: number
  unit: string
  // The buyer's own reference price for this line (last year, last PO, current contract).
  refPrice: number | null
}

export interface Question {
  id: string
  text: string
  gate: boolean
}

export interface Rfx {
  id: string
  title: string
  buyer: string
  scope: string
  currency: string
  // "year" for a rate contract, "once" for a one-time buy. Only changes labels.
  period: 'year' | 'once'
  quantityLabel: string
  // What refPrice is, in the buyer's words: "last year", "last PO", "current contract".
  refLabel: string
  // What the freight field of a reading means for this event. Defaults to "Freight".
  // A freight contract uses it for tolls and other extras.
  extrasLabel?: string
  attributes: AttributeDef[]
  lineItems: LineItem[]
  questionnaire: Question[]
  terms: Record<string, string>
}

// ---- What the model returns for one vendor document (it reads, it does not compute) ----
export type PriceBasis = 'per_unit' | 'per_n_units' | 'per_measure' | 'other'
export type TermStatus = 'included' | 'extra' | 'not_stated'
export type Meets = 'yes' | 'no' | 'unclear' | 'not_applicable'
export type MatchQuality = 'exact' | 'substitute' | 'unsure'

export interface ExtractedAttribute {
  key: string
  value_number: number | null
  value_text: string
  quote: string
}

export interface ExtractedItem {
  rfx_line_id: string | null
  vendor_item_label: string
  price_text: string
  price_value: number | null
  unit_text: string
  price_basis: PriceBasis
  units_per_pack: number | null
  measure: string
  currency: string
  match: MatchQuality
  offered_item: string
  tiers: { min_quantity: number; price_value: number; price_text: string }[]
  addons: { key: string; label: string; price_value: number; price_text: string; quote: string }[]
  attributes: ExtractedAttribute[]
  // Minimum order quantity for this item, in the units the price is quoted for. Null means none stated.
  moq?: number | null
  quote: string
  note: string | null
}

export interface ExtractedReference {
  kind: 'previous_price' | 'other'
  scope: 'all_lines_not_otherwise_quoted' | 'listed_lines'
  line_ids: string[]
  excluded_line_ids: string[]
  adjustment_percent: number | null
  quote: string
  note: string | null
}

export interface ExtractedAnswer {
  question_id: string
  answered: boolean
  answer: string | null
  meets_requirement: Meets
  quote: string | null
}

export interface Extraction {
  vendor_name: string | null
  items: ExtractedItem[]
  references: ExtractedReference[]
  vendor_attributes: ExtractedAttribute[]
  answers: ExtractedAnswer[]
  terms: {
    freight: { status: TermStatus; quote: string | null }
    gst: { status: TermStatus; quote: string | null }
    discount: { percent: number | null; condition: string | null; quote: string | null }
    validity: { text: string | null; quote: string | null }
    payment: { text: string | null; quote: string | null }
    // A price tied to an index, for example a diesel clause on a freight rate.
    index_clause: { index_name: string | null; percent_per_unit: number | null; quote: string | null }
  }
  document_notes: string[]
}

// ---- Replies (one per vendor document) ----
export type ProviderId = 'anthropic' | 'openai'

export interface Reply {
  id: string
  vendorName: string
  fileName: string
  format: string
  source: 'sample' | 'upload'
  status: 'received' | 'extracting' | 'done' | 'error'
  error?: string
  extraction?: Extraction
  // Text the model was given, for text formats. Used by the source viewer.
  docText?: string
  provider?: ProviderId
  model?: string
  seconds?: number
}

// ---- Buyer decisions ----
export interface Decisions {
  // rule id -> accepted
  rules: Record<string, boolean>
  // `${replyId}|${lineId}` -> doubt codes the buyer confirmed
  doubts: Record<string, string[]>
  // `${replyId}|${lineId}` -> price the buyer typed
  overrides: Record<string, number>
  // replyId -> apply the vendor's discount or not. Unset means the default:
  // applied when unconditional, not applied when it has a condition.
  discount: Record<string, boolean>
  // blocker ids the buyer marked as noted
  noted: Record<string, boolean>
}

export const emptyDecisions = (): Decisions => ({ rules: {}, doubts: {}, overrides: {}, discount: {}, noted: {} })

// ---- The comparison grid (built by code from extractions + decisions) ----
// A rule is a conversion code applied to many of one vendor's cells for one stated reason.
export type RuleCode = 'unit' | 'currency' | 'discount' | 'reference' | 'tier' | 'vendor_attribute' | 'moq'
// A doubt is something wrong or unclear with one cell.
export type DoubtCode =
  | 'outlier'
  | 'off_reference'
  | 'note'
  | 'duplicate'
  | 'unreadable'
  | 'quote_not_found'
  | 'substitute'
  | 'match_unsure'

export interface Doubt {
  code: DoubtCode
  text: string
  confirmed: boolean
}

// Basis is always visible and never amber.
export type Basis = 'quoted' | 'converted' | 'assumed' | 'edited'
// Check is what needs the buyer's eyes.
export type Check = 'none' | 'look' | 'no_price' | 'not_quoted'

export interface CellAttribute {
  num: number | null
  text: string
  quote: string
  vendorWide: boolean
}

export interface Cell {
  replyId: string
  lineId: string
  basis: Basis | null
  check: Check
  // Price per RFx unit in the RFx currency, after code conversion.
  unitPrice: number | null
  lineCost: number | null
  // Short quiet markers shown in the cell: ÷100, per kg, USD, -4%, LY, tier, sub, MOQ.
  marks: string[]
  // Ids of the rules that produced this price.
  ruleIds: string[]
  // True while any of those rules has not been accepted by the buyer.
  ruleOpen: boolean
  rawText: string | null
  unitText: string | null
  vendorLabel: string | null
  quote: string | null
  steps: string[]
  doubts: Doubt[]
  match: MatchQuality
  offered: string | null
  attributes: Record<string, CellAttribute>
  // Optional add-ons priced per unit, kept apart from the base price.
  addons: { key: string; label: string; unitPrice: number; quote: string }[]
  // Converted price by quantity tier, when the vendor quoted tiers.
  tiers: { minQty: number; unitPrice: number }[]
  // Most units this vendor said it can supply on this line per period. Null means no limit stated.
  capacity: number | null
  // The vendor's minimum order on this line, in RFx units. Null means none stated.
  moq: number | null
}

export interface Rule {
  id: string
  replyId: string
  vendorName: string
  code: RuleCode
  title: string
  // Describes the whole group, never one cell.
  text: string
  quote: string | null
  lineIds: string[]
  amount: number
  accepted: boolean
  // Only for a conditional discount: both totals, so the buyer can choose.
  choice?: { percent: number; condition: string; applied: boolean; decided: boolean; listTotal: number; discountedTotal: number }
}

export interface Blocker {
  id: string
  replyId: string
  vendorName: string
  kind: 'gate' | 'freight' | 'lines' | 'unmatched' | 'no_answers'
  title: string
  text: string
  amount: number
  noted: boolean
}

export type GateStatus = 'pass' | 'fail' | 'unclear' | 'not_answered'

export interface VendorSummary {
  replyId: string
  name: string
  fileName: string
  readBy: string
  linesQuoted: number
  totalLines: number
  counts: { clean: number; look: number; noPrice: number; notQuoted: number; underOpenRule: number }
  costQuoted: number
  // Cost on the lines every vendor priced, so totals can be compared. Null when there are none.
  likeForLike: number | null
  // True while any price in the totals is under an unaccepted rule or an open doubt.
  provisional: boolean
  freight: TermStatus
  gst: TermStatus
  discount: { percent: number; condition: string | null; quote: string | null; applied: boolean; decided: boolean } | null
  indexClause: { indexName: string; percentPerUnit: number; quote: string | null } | null
  validity: string | null
  payment: string | null
  gate: GateStatus
  answers: Record<string, ExtractedAnswer | undefined>
  unmatched: ExtractedItem[]
  notes: string[]
}

export interface Grid {
  rfx: Rfx
  lines: LineItem[]
  questionnaire: Question[]
  vendors: VendorSummary[]
  cells: Record<string, Record<string, Cell>>
  rules: Rule[]
  blockers: Blocker[]
  // Line ids every vendor priced.
  commonLineIds: string[]
}

// ---- Chat ----
export interface ToolCallRecord {
  name: string
  input: unknown
  result: unknown
  isError?: boolean
}

export interface AnalystAnswer {
  headline: string
  points: string[]
  caveats: string[]
  follow_ups: string[]
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  answer?: AnalystAnswer
  toolCalls?: ToolCallRecord[]
  error?: boolean
}
