// Shared helpers for the dataset scripts.
export function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const r2 = (n) => Math.round(n * 100) / 100;
export const money = (n, d = 2) => n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
export const lineId = (i) => `L${String(i + 1).padStart(2, '0')}`;

// Same fixed demo rate as src/config.ts. Used only to make a vendor's USD prices.
export const FX_USD_INR = 88;

// Questionnaire answers for a perfect reading, in the shape the extraction schema uses.
export function perfectAnswers(rfx, answers) {
  return rfx.questionnaire.map((q) => {
    const a = answers?.[q.id];
    return { question_id: q.id, answered: !!a, answer: a?.text ?? null, meets_requirement: a ? (q.gate ? a.meets : 'not_applicable') : 'not_applicable', quote: a?.text ?? null };
  });
}

// One item of a perfect reading. Dataset files pass only what differs from the plain case.
export const perfectItem = (o) => ({
  rfx_line_id: o.lineId,
  vendor_item_label: o.label ?? o.lineId,
  price_text: String(o.price ?? ''),
  price_value: o.price ?? null,
  unit_text: o.unitText ?? 'each',
  price_basis: o.basis ?? 'per_unit',
  units_per_pack: o.pack ?? null,
  measure: o.measure ?? '',
  currency: o.currency ?? 'INR',
  match: o.match ?? 'exact',
  offered_item: o.offered ?? '',
  tiers: o.tiers ?? [],
  addons: o.addons ?? [],
  attributes: o.attributes ?? [],
  moq: o.moq ?? null,
  quote: 'selftest',
  note: null,
});

export const perfectTerms = (t) => ({
  freight: { status: t.freight, quote: null },
  gst: { status: t.gst === 'not stated' ? 'not_stated' : t.gst, quote: null },
  discount: { percent: t.discountPct || null, condition: t.discountCondition ?? null, quote: null },
  validity: { text: t.validity ?? null, quote: null },
  payment: { text: null, quote: null },
  index_clause: { index_name: t.indexName ?? null, percent_per_unit: t.indexPercentPerUnit ?? null, quote: null },
});

// A perfect reading written the way the model writes it: the flat schema in src/lib/extract.ts,
// with empty strings and zeros for "nothing". The self-test sends this through the app's own
// toExtraction(), so the mapping back is tested too.
export function toRaw(e) {
  const details = [];
  const d = (kind, rfx_line_id, o) => details.push({ kind, rfx_line_id, key: '', label: '', number: 0, has_number: false, min_quantity: 0, quote: 'selftest', ...o });
  const attr = (lineId, a) => d('attribute', lineId, { key: a.key, label: a.value_text ?? '', number: a.value_number ?? 0, has_number: a.value_number != null });
  for (const i of e.items) {
    for (const t of i.tiers) d('price_break', i.rfx_line_id, { number: t.price_value, has_number: true, min_quantity: t.min_quantity });
    for (const a of i.addons) d('addon', i.rfx_line_id, { key: a.key, label: a.label, number: a.price_value, has_number: true });
    for (const a of i.attributes) attr(i.rfx_line_id, a);
    if (i.moq) d('min_order', i.rfx_line_id, { number: i.moq, has_number: true });
  }
  for (const a of e.vendor_attributes) attr('', a);
  const t = e.terms;
  return {
    vendor_name: e.vendor_name ?? '',
    items: e.items.map(({ tiers, addons, attributes, moq, ...i }) => ({ ...i, rfx_line_id: i.rfx_line_id ?? '', price_value: i.price_value ?? 0, units_per_pack: i.units_per_pack ?? 0, note: i.note ?? '' })),
    details,
    references: e.references.map((r) => ({ ...r, adjustment_percent: r.adjustment_percent ?? 0, note: r.note ?? '' })),
    answers: e.answers.map((a) => ({ ...a, answer: a.answer ?? '', quote: a.quote ?? '' })),
    terms: {
      freight_status: t.freight.status,
      freight_quote: t.freight.quote ?? '',
      gst_status: t.gst.status,
      gst_quote: t.gst.quote ?? '',
      discount_percent: t.discount.percent ?? 0,
      discount_condition: t.discount.condition ?? '',
      discount_quote: t.discount.quote ?? '',
      validity: t.validity.text ?? '',
      payment: t.payment.text ?? '',
      index_name: t.index_clause.index_name ?? '',
      index_percent_per_unit: t.index_clause.percent_per_unit ?? 0,
      index_quote: t.index_clause.quote ?? '',
    },
    document_notes: e.document_notes,
  };
}
