// Packaging dataset: the RFx, last year's prices, what each vendor "really" quoted, and how the
// five reply files are rendered. The vendors object is the answer key. It is written to
// scripts/truth/packaging.json and must never reach src/ or public/.
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { FX_USD_INR, mulberry32, money, perfectAnswers, perfectItem, perfectTerms, r2 } from '../lib.mjs';

export const meta = {
  id: 'packaging',
  title: 'Corrugated packaging',
  buyer: 'Nimbus Home Care Pvt Ltd',
  kind: 'Annual rate contract',
  value: '₹4 crore',
  valueNote: 'a year',
  summary: '30 carton and mailer sizes for a D2C home-care brand, about ₹4 crore a year.',
  whyCheapestIsWrong: 'The cheapest vendor fails the quality gate.',
  edges: [
    'Excel with its own item codes, some prices per 100',
    'PDF with a 4% discount hidden in a footnote',
    'Word doc quoting in USD, prices inside paragraphs',
    'Angled photo of a rate card, 27 of 30 lines, mailers per box of 25',
    'Three-line email: per kg, and "rest same as last year"',
  ],
  questions: [
    "What came back, and what can't I trust yet?",
    'What if we split it, cheapest per line, but only among vendors who cleared the quality questionnaire?',
    'What does that cost versus giving it all to one vendor?',
    'Cap it at two vendors.',
    'Where are prices up most against last year? Show a chart.',
    'Which vendor has the best on-time delivery?',
  ],
};

// [L, W, H, ply, kind, unit weight g, last year Rs/kg, relative volume]
const RAW = [
  [200, 150, 100, 3, 'box', 95, 41.5, 90],
  [250, 200, 150, 3, 'box', 150, 40.5, 110],
  [300, 200, 150, 3, 'box', 170, 40.0, 120],
  [300, 250, 200, 3, 'box', 220, 39.5, 95],
  [350, 250, 150, 3, 'box', 215, 39.0, 85],
  [350, 300, 200, 3, 'box', 275, 39.5, 80],
  [400, 300, 200, 3, 'box', 300, 38.5, 100],
  [400, 300, 300, 3, 'box', 365, 38.0, 70],
  [450, 300, 250, 3, 'box', 360, 37.5, 60],
  [450, 350, 300, 3, 'box', 440, 38.5, 55],
  [500, 350, 300, 3, 'box', 470, 37.5, 50],
  [500, 400, 300, 3, 'box', 520, 38.0, 45],
  [350, 250, 200, 5, 'box', 400, 45.5, 90],
  [400, 300, 250, 5, 'box', 520, 45.0, 110],
  [450, 300, 300, 5, 'box', 610, 44.5, 100],
  [450, 350, 300, 5, 'box', 680, 44.0, 95],
  [500, 350, 350, 5, 'box', 790, 43.5, 85],
  [500, 400, 350, 5, 'box', 850, 44.0, 80],
  [550, 400, 400, 5, 'box', 990, 43.0, 70],
  [600, 400, 400, 5, 'box', 1050, 42.5, 65],
  [600, 450, 400, 5, 'box', 1130, 43.0, 55],
  [650, 450, 450, 5, 'box', 1290, 42.5, 45],
  [600, 400, 400, 7, 'box', 1480, 48.0, 28],
  [650, 450, 450, 7, 'box', 1810, 47.5, 24],
  [700, 500, 500, 7, 'box', 2180, 47.0, 18],
  [800, 600, 500, 7, 'box', 2760, 46.5, 12],
  [220, 160, 50, 3, 'mailer', 70, 62.0, 150],
  [260, 200, 60, 3, 'mailer', 98, 61.0, 140],
  [320, 240, 80, 3, 'mailer', 145, 60.0, 110],
  [380, 280, 100, 3, 'mailer', 195, 59.0, 80],
];

const VOLUME_SCALE = 845; // tuned so last year's spend lands near Rs 4 crore

// Internal line records. The RFx the app sees is built from these below.
const lines = RAW.map(([L, W, H, ply, kind, weightG, perKg, relVol], i) => ({
  id: `L${String(i + 1).padStart(2, '0')}`,
  description:
    kind === 'mailer'
      ? `E-flute die-cut mailer box, self-locking, ${L} x ${W} x ${H} mm, brown kraft`
      : `${ply}-ply RSC shipper carton, ${L} x ${W} x ${H} mm, brown kraft`,
  kind,
  ply,
  lengthMm: L,
  widthMm: W,
  heightMm: H,
  unitWeightG: weightG,
  annualVolume: relVol * VOLUME_SCALE,
  lastYearPrice: r2((weightG / 1000) * perKg),
}));
const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
const size = (l, sep = ' x ') => `${l.lengthMm}${sep}${l.widthMm}${sep}${l.heightMm}`;

const questionnaire = [
  { id: 'Q1', gate: true, text: 'Do you hold a currently valid ISO 9001:2015 certificate for the plant that will supply us? Give the expiry date.' },
  { id: 'Q2', gate: true, text: 'Do you test every lot in-house for bursting strength, ECT and BCT, and share the test report with each dispatch?' },
  { id: 'Q3', gate: true, text: 'Is your kraft paper FSC-certified or at least 70% recycled content, with documents available on request?' },
  { id: 'Q4', gate: false, text: 'What is your lead time from purchase order to delivery, in days?' },
  { id: 'Q5', gate: false, text: 'What is your monthly production capacity, in tonnes?' },
  { id: 'Q6', gate: false, text: 'Do you accept payment terms of 60 days from invoice?' },
  { id: 'Q7', gate: false, text: 'How long are the quoted prices valid?' },
  { id: 'Q8', gate: false, text: 'What was your customer rejection rate over the last 12 months, in percent?' },
];

export const rfx = {
  id: 'RFQ-2026-PKG-014',
  title: 'Annual rate contract: corrugated shipper cartons and mailer boxes, FY 2026-27',
  buyer: 'Nimbus Home Care Pvt Ltd',
  scope:
    'Supply of corrugated shipper cartons and e-commerce mailer boxes for 12 months to our fulfilment centre at Bhiwandi, Maharashtra. Volumes are annual estimates, called off monthly.',
  currency: 'INR',
  period: 'year',
  quantityLabel: 'Annual volume',
  refLabel: 'last year',
  attributes: [],
  lineItems: lines.map((l) => ({
    id: l.id,
    description: l.description,
    spec: `${size(l)} mm`,
    category: l.kind === 'mailer' ? 'Mailers' : `${l.ply}-ply cartons`,
    measures: { kg: l.unitWeightG / 1000 },
    quantity: l.annualVolume,
    unit: 'piece',
    refPrice: l.lastYearPrice,
  })),
  questionnaire,
  terms: {
    priceBasis: 'Per piece, in INR, delivered to Bhiwandi (freight included), GST shown separately',
    delivery: 'Monthly call-offs, delivered to Nimbus fulfilment centre, Bhiwandi',
    payment: '60 days from invoice',
    validity: 'Prices firm for 12 months from award',
    responseDue: '2026-10-20',
  },
};

// ---- What each vendor really quoted ----
function spread(seed, factor, noise) {
  const rnd = mulberry32(seed);
  return lines.map((l) => l.lastYearPrice * factor * (1 + (rnd() * 2 - 1) * noise));
}

// A: Excel. Own layout and codes. Small 3-ply and mailers priced per 100 pcs.
const aBase = spread(11, 1.02, 0.07);
const A_PER_100 = new Set(['L01', 'L02', 'L03', 'L04', 'L05', 'L27', 'L28', 'L29', 'L30']);
const vendorA = lines.map((l, i) => {
  if (A_PER_100.has(l.id)) {
    const raw = Math.round(aBase[i] * 100);
    return { lineId: l.id, rawPrice: raw, rawUnit: 'per 100 Nos', rawCurrency: 'INR', unitInr: r2(raw / 100) };
  }
  const raw = r2(aBase[i]);
  return { lineId: l.id, rawPrice: raw, rawUnit: 'per No', rawCurrency: 'INR', unitInr: raw };
});

// B: PDF. List prices per piece. 4% discount only in a footnote, with a condition.
const B_DISCOUNT_PCT = 4;
const bBase = spread(22, 0.99, 0.04);
const vendorB = lines.map((l, i) => {
  const raw = r2(bBase[i]);
  return { lineId: l.id, rawPrice: raw, rawUnit: 'per pc', rawCurrency: 'INR', unitInr: raw, unitInrAfterDiscount: r2(raw * (1 - B_DISCOUNT_PCT / 100)) };
});

// C: Word. Prices in paragraphs, in USD.
const cBase = spread(33, 1.0, 0.08);
const vendorC = lines.map((l, i) => {
  const usd = Math.round((cBase[i] / FX_USD_INR) * 1000) / 1000;
  return { lineId: l.id, rawPrice: usd, rawUnit: 'each', rawCurrency: 'USD', unitInr: r2(usd * FX_USD_INR) };
});

// D: photo of a rate card. 27 of 30 lines. Mailer rates are per box of 25.
const dBase = spread(44, 0.95, 0.05);
const D_SKIPPED = new Set(['L25', 'L26', 'L30']);
const vendorD = lines
  .map((l, i) => {
    if (D_SKIPPED.has(l.id)) return null;
    if (l.kind === 'mailer') {
      const raw = Math.round(dBase[i] * 25);
      return { lineId: l.id, rawPrice: raw, rawUnit: 'per box of 25 pcs', rawCurrency: 'INR', unitInr: r2(raw / 25) };
    }
    const raw = r2(Math.round(dBase[i] * 10) / 10);
    return { lineId: l.id, rawPrice: raw, rawUnit: 'per pc', rawCurrency: 'INR', unitInr: raw };
  })
  .filter(Boolean);

// E: three-line email. Per kg for 5-ply and 3-ply, rest same as last year, freight extra.
const E_PER_KG = { 3: 38, 5: 42 };
const vendorE = lines.map((l) => {
  if (l.kind === 'box' && E_PER_KG[l.ply]) {
    const perKg = E_PER_KG[l.ply];
    return { lineId: l.id, rawPrice: perKg, rawUnit: 'per kg', rawCurrency: 'INR', unitInr: r2((perKg * l.unitWeightG) / 1000) };
  }
  return { lineId: l.id, rawPrice: null, rawUnit: 'same as last year', rawCurrency: 'INR', unitInr: l.lastYearPrice, fromLastYear: true };
});

export const vendors = {
  A: {
    id: 'A',
    name: 'Shree Balaji Packaging Pvt Ltd',
    file: 'vendor-a-shree-balaji-quote.xlsx',
    format: 'Excel',
    hard: 'Their own layout and item codes, in their own order. Units differ from row to row.',
    quotes: vendorA,
    terms: { freight: 'included', gst: 'extra', discountPct: 0, validity: '12 months' },
    answers: {
      Q1: { meets: 'yes', text: 'Yes. ISO 9001:2015, certificate valid up to 14 Aug 2028 (TUV).' },
      Q2: { meets: 'yes', text: 'Yes, in-house lab. BS, ECT and BCT tested per lot, COA sent with every dispatch.' },
      Q3: { meets: 'yes', text: 'FSC Mix certified kraft. Chain of custody certificate available.' },
      Q4: { meets: 'na', text: '10 days from PO' },
      Q5: { meets: 'na', text: '1,800 MT per month' },
      Q6: { meets: 'na', text: 'Agreed, 60 days' },
      Q7: { meets: 'na', text: '12 months, subject to kraft paper index review every 6 months' },
      Q8: { meets: 'na', text: '0.6%' },
    },
  },
  B: {
    id: 'B',
    name: 'Kraftline Industries',
    file: 'vendor-b-kraftline-quotation.pdf',
    format: 'PDF',
    hard: 'A letterhead PDF. Read the footnote under the table, not just the table.',
    quotes: vendorB,
    terms: {
      freight: 'included',
      gst: 'extra',
      discountPct: B_DISCOUNT_PCT,
      discountCondition: 'only if annual offtake value exceeds Rs 50 lakh, passed by credit note at quarter end',
      validity: '6 months',
    },
    answers: {
      Q1: { meets: 'no', text: 'Our ISO 9001:2015 certificate expired on 31 March 2026. Recertification audit is scheduled for November 2026.' },
      Q2: { meets: 'yes', text: 'Yes. BS, ECT and BCT are tested in our lab for every lot and the report travels with the consignment.' },
      Q3: { meets: 'yes', text: 'We use 80% recycled kraft. Mill declarations can be shared.' },
      Q4: { meets: 'na', text: '7 working days' },
      Q5: { meets: 'na', text: '2,400 tonnes per month' },
      Q6: { meets: 'na', text: 'We request 45 days. 60 days can be discussed.' },
      Q7: { meets: 'na', text: '6 months' },
      Q8: { meets: 'na', text: '0.9%' },
    },
  },
  C: {
    id: 'C',
    name: 'PackGlobal Exports LLP',
    file: 'vendor-c-packglobal-offer.docx',
    format: 'Word',
    hard: 'Prices sit inside paragraphs, not a table, and not in rupees.',
    quotes: vendorC,
    terms: { freight: 'included', gst: 'extra', discountPct: 0, validity: '90 days' },
    answers: {
      Q1: { meets: 'yes', text: 'ISO 9001:2015 certified, valid until 30 June 2027.' },
      Q2: { meets: 'yes', text: 'Every lot is tested in our own laboratory for bursting strength, ECT and BCT. Reports accompany each dispatch.' },
      Q3: { meets: 'yes', text: 'Kraft liner is FSC certified. Certificate copies are available on request.' },
      Q4: { meets: 'na', text: '12 to 14 days' },
      Q5: { meets: 'na', text: 'about 3,000 tonnes a month' },
      Q6: { meets: 'na', text: '60 days is acceptable' },
      Q7: { meets: 'na', text: '90 days from the date of this offer' },
      Q8: { meets: 'na', text: 'below 0.5%' },
    },
  },
  D: {
    id: 'D',
    name: 'Maruti Corrugators',
    file: 'vendor-d-maruti-rate-card.jpg',
    format: 'Photo',
    hard: 'A phone photo of a printed card, taken at an angle. Not every line is on it, and one group is priced by the box.',
    quotes: vendorD,
    terms: { freight: 'extra', gst: 'extra', discountPct: 0, validity: 'not stated' },
    answers: null,
  },
  E: {
    id: 'E',
    name: 'Sai Cartons',
    file: 'vendor-e-sai-cartons-email.txt',
    format: 'Email',
    hard: 'Three lines. It prices by weight and points at last year instead of writing most prices.',
    quotes: vendorE,
    terms: { freight: 'extra', gst: 'not stated', discountPct: 0, validity: 'not stated' },
    answers: null,
  },
};

// What the grid should show per line with default decisions (a conditional discount is not applied).
export const expected = (v) => Object.fromEntries(v.quotes.map((q) => [q.lineId, q.unitInr]));

// A perfect reading of one vendor, in the extraction schema. Used by the self-test only.
export function perfectExtraction(v) {
  const items = v.quotes
    .filter((q) => !q.fromLastYear)
    .map((q) => {
      const m = q.rawUnit.match(/(\d+)/);
      const perKg = q.rawUnit === 'per kg';
      return perfectItem({
        lineId: q.lineId,
        price: q.rawPrice,
        unitText: q.rawUnit,
        basis: perKg ? 'per_measure' : m ? 'per_n_units' : 'per_unit',
        pack: !perKg && m ? Number(m[1]) : null,
        measure: perKg ? 'kg' : '',
        currency: q.rawCurrency,
      });
    });
  const hasRef = v.quotes.some((q) => q.fromLastYear);
  return {
    vendor_name: v.name,
    items,
    references: hasRef
      ? [{ kind: 'previous_price', scope: 'all_lines_not_otherwise_quoted', line_ids: [], excluded_line_ids: [], adjustment_percent: null, quote: 'rest same as last year', note: null }]
      : [],
    vendor_attributes: [],
    answers: perfectAnswers(rfx, v.answers),
    terms: perfectTerms(v.terms),
    document_notes: [],
  };
}

// Dataset-specific self-test checks. Returns lines to print. `h` gives the app's own functions.
export function checks(grid, h) {
  const out = [];
  out.push(`rules: ${grid.rules.filter((r) => !r.accepted).length} (expected 6), amber cells: ${grid.vendors.reduce((n, v) => n + v.counts.look, 0)} (expected 0)`);
  const vp = h.awardScenario(grid, { eligible_vendors: 'passed_quality_gate' });
  const any = h.awardScenario(grid, { eligible_vendors: 'all', max_vendors: 1 });
  out.push(`VP question (cheapest per line, cleared the gate): ${vp.total_cost.toFixed(2)} over ${vp.lines_awarded} lines, eligible: ${vp.eligible_vendors.join(', ')}`);
  out.push(`  split: ${vp.vendors_in_award.map((x) => `${x.vendor} ${x.lines} lines ${x.cost}`).join(' | ')}`);
  out.push(`  cheapest single vendor ignoring the gate: ${any.vendors_in_award.map((x) => x.vendor).join(', ')} ${any.total_cost} (gate: ${grid.vendors.find((v) => v.name === any.vendors_in_award[0]?.vendor)?.gate})`);
  // Independent hand calculation straight from the answer key, not through the app's code.
  const ok = Object.values(vendors).filter((v) => v.answers && !Object.values(v.answers).some((a) => a.meets === 'no'));
  let hand = 0;
  for (const l of lines) {
    const ps = ok.map((v) => v.quotes.find((q) => q.lineId === l.id)?.unitInr).filter((p) => p != null);
    hand += Math.round(Math.min(...ps) * l.annualVolume * 100) / 100;
  }
  out.push(`  hand calculation from the answer key (${ok.map((v) => v.id).join('+')}): ${hand.toFixed(2)}  vs app ${vp.total_cost.toFixed(2)}  ${Math.abs(hand - vp.total_cost) < 1 ? 'MATCH' : 'DIFFERENT'}`);
  // Planted misreads: a reader that misses a unit must still produce an amber cell.
  if (h.replies.every((r) => r.extraction?.items.every((i) => i.quote === 'selftest'))) {
    const plant = (vendorId, lineId, change) => {
      const replies = structuredClone(h.replies);
      Object.assign(replies.find((r) => r.id === vendorId).extraction.items.find((i) => i.rfx_line_id === lineId), change);
      const c = h.buildGrid(rfx, replies, h.emptyDecisions()).cells[vendorId][lineId];
      return `${vendorId} ${lineId} -> ${c.unitPrice}, ${c.check === 'look' ? 'AMBER' : 'NOT AMBER'} (${c.doubts.map((d) => d.code).join(',') || 'no doubt'})`;
    };
    out.push('Planted misreads (each should be AMBER):');
    out.push(`  per 100 read as per piece:      ${plant('A', 'L01', { price_basis: 'per_unit', units_per_pack: null })}`);
    out.push(`  box of 25 read as per piece:    ${plant('D', 'L27', { price_basis: 'per_unit', units_per_pack: null })}`);
    out.push(`  per kg read as per piece (L13): ${plant('E', 'L13', { price_basis: 'per_unit', measure: '' })}`);
    out.push(`  per kg read as per piece (L20, a carton near 1 kg. Known gap, the error is about 5%): ${plant('E', 'L20', { price_basis: 'per_unit', measure: '' })}`);
    out.push(`  USD read as INR:                ${plant('C', 'L10', { currency: 'INR' })}`);
    out.push(`  a digit misread (L15 x1.5):     ${plant('B', 'L15', { price_value: Math.round(vendors.B.quotes[14].rawPrice * 150) / 100 })}`);
  }
  return out;
}

// ---------- Rendering the five reply files ----------

// A: Excel, own layout and SKU codes
async function makeA(out) {
  const v = vendors.A;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Quotation');
  ws.columns = [{ width: 6 }, { width: 16 }, { width: 46 }, { width: 10 }, { width: 14 }, { width: 14 }];
  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = 'SHREE BALAJI PACKAGING PVT LTD';
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1F4E79' } };
  ws.mergeCells('A2:F2');
  ws.getCell('A2').value = 'Plot 41, GIDC Phase II, Vapi 396195 | GSTIN 24AAECS1234F1Z5 | sales@shreebalajipack.example';
  ws.mergeCells('A3:F3');
  ws.getCell('A3').value = 'QUOTATION No. SBP/Q/2026-27/0388        Date: 14-10-2026';
  ws.getCell('A3').font = { bold: true };
  ws.mergeCells('A4:F4');
  ws.getCell('A4').value = 'To: Nimbus Home Care Pvt Ltd, Bhiwandi.   Ref: your enquiry RFQ-2026-PKG-014';
  const head = ws.getRow(6);
  head.values = ['Sr', 'Our Item Code', 'Particulars', 'UOM', 'Rate (Rs)', 'Annual Qty (Nos)'];
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    c.border = { bottom: { style: 'thin' } };
  });
  // Their own order: mailers first, then by ply descending.
  const order = [...v.quotes].sort((a, b) => {
    const la = byId[a.lineId];
    const lb = byId[b.lineId];
    const ka = la.kind === 'mailer' ? 0 : 10 - la.ply;
    const kb = lb.kind === 'mailer' ? 0 : 10 - lb.ply;
    return ka - kb || la.lengthMm - lb.lengthMm || la.widthMm - lb.widthMm || la.heightMm - lb.heightMm;
  });
  order.forEach((q, i) => {
    const l = byId[q.lineId];
    const code =
      l.kind === 'mailer'
        ? `SBP-ML-${l.lengthMm}${String(l.heightMm).padStart(3, '0')}`
        : `SBP-${l.ply}P-${String(l.lengthMm).slice(0, 2)}${String(l.widthMm).slice(0, 2)}${String(l.heightMm).slice(0, 2)}`;
    const desc =
      l.kind === 'mailer'
        ? `Mailer Box E-Flute Die Cut ${size(l, 'X')} Self Lock (Plain Brown)`
        : `Corr. Box ${l.ply}Ply RSC ${size(l, 'X')} (Plain Brown)`;
    const row = ws.getRow(7 + i);
    row.values = [i + 1, code, desc, q.rawUnit === 'per 100 Nos' ? '100 Nos' : 'Nos', q.rawPrice, l.annualVolume];
    row.getCell(5).numFmt = '#,##0.00';
    row.getCell(6).numFmt = '#,##0';
  });
  const t = 7 + order.length + 1;
  const notes = [
    'Terms & Conditions:',
    '1. Rates are F.O.R. your Bhiwandi warehouse (freight included).',
    '2. GST extra as applicable.',
    '3. Rates for items with UOM "100 Nos" are per hundred pieces.',
    '4. Payment 60 days. Rates valid 12 months, subject to kraft paper index review every 6 months.',
  ];
  notes.forEach((n, i) => {
    ws.mergeCells(`A${t + i}:F${t + i}`);
    ws.getCell(`A${t + i}`).value = n;
    if (i === 0) ws.getCell(`A${t + i}`).font = { bold: true };
  });

  const ws2 = wb.addWorksheet('Vendor Profile');
  ws2.columns = [{ width: 44 }, { width: 80 }];
  ws2.getRow(1).values = ['Point', 'Our response'];
  ws2.getRow(1).font = { bold: true };
  const rowsA = [
    ['ISO 9001 status', v.answers.Q1.text],
    ['Lot testing (BS / ECT / BCT)', v.answers.Q2.text],
    ['Paper sourcing / FSC', v.answers.Q3.text],
    ['Delivery lead time', v.answers.Q4.text],
    ['Installed capacity', v.answers.Q5.text],
    ['Credit period 60 days', v.answers.Q6.text],
    ['Price validity', v.answers.Q7.text],
    ['Customer rejections, last 12 months', v.answers.Q8.text],
  ];
  rowsA.forEach((r, i) => (ws2.getRow(2 + i).values = r));
  await wb.xlsx.writeFile(path.join(out, v.file));
}

// B: PDF on letterhead, discount only in a footnote
function htmlB() {
  const v = vendors.B;
  const rows = v.quotes
    .map((q, i) => {
      const l = byId[q.lineId];
      const d = l.kind === 'mailer' ? `Die-cut mailer, E-flute, ${size(l)} mm` : `${l.ply} Ply RSC carton, ${size(l)} mm`;
      return `<tr><td>${i + 1}</td><td>${d}</td><td class="r">${l.annualVolume.toLocaleString('en-IN')}</td><td class="r">${money(q.rawPrice)}</td></tr>`;
    })
    .join('');
  const qa = questionnaire.map((q, i) => `<p class="qa"><b>${i + 1}. ${q.text}</b><br>${v.answers[q.id].text}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 16mm 15mm 18mm 15mm; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 10.5pt; color: #1b1b1b; }
  .lh { border-bottom: 3px double #7a3b12; padding-bottom: 8px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
  .lh h1 { margin: 0; font-size: 22pt; letter-spacing: 2px; color: #7a3b12; }
  .lh .sub { font-size: 8.5pt; color: #555; text-align: right; line-height: 1.4; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { background: #f1e6da; text-align: left; border: 1px solid #b9a48e; padding: 4px 6px; font-size: 9.5pt; }
  td { border: 1px solid #cdbfae; padding: 3px 6px; font-size: 9.5pt; }
  .r { text-align: right; }
  .fn { font-size: 6.5pt; color: #666; margin-top: 10px; line-height: 1.35; }
  .qa { margin: 7px 0; }
  h2 { font-size: 12pt; color: #7a3b12; margin-top: 18px; }
  .sig { margin-top: 26px; }
  </style></head><body>
  <div class="lh"><div><h1>KRAFTLINE INDUSTRIES</h1><div style="font-size:9pt;color:#555">Manufacturers of corrugated boxes and board since 1994</div></div>
  <div class="sub">Survey No. 212/3, Chakan Industrial Area, Pune 410501<br>GSTIN 27AAAFK4321L1ZP · +91 2135 000 000<br>quotes@kraftline.example</div></div>
  <p><b>Quotation KL/26-27/1107</b> &nbsp;·&nbsp; 15 October 2026</p>
  <p>To: Purchase Department, Nimbus Home Care Pvt Ltd, Bhiwandi<br>Subject: Offer against your RFQ-2026-PKG-014, annual rate contract for corrugated cartons</p>
  <p>Dear Sir / Madam, we thank you for the enquiry and are pleased to offer our rates as under.</p>
  <table><thead><tr><th style="width:8%">Sr.</th><th>Description</th><th class="r" style="width:17%">Annual qty (pcs)</th><th class="r" style="width:19%">Rate per pc (Rs)<sup>1</sup></th></tr></thead><tbody>${rows}</tbody></table>
  <div class="fn"><sup>1</sup> Basic rate per piece, delivered to your Bhiwandi fulfilment centre. GST extra at the prevailing rate. Rates valid for 6 months from the date of this quotation.
  A volume discount of 4% on the above rates will apply if the annual offtake value exceeds Rs 50 lakh, and will be passed on by credit note at the end of each quarter. Tolerance on quantity ±5%. Printing, if any, charged extra.</div>
  <h2 style="page-break-before: always">Annexure: replies to your supplier questionnaire</h2>
  ${qa}
  <p class="sig">For Kraftline Industries<br><br><br>Authorised Signatory</p>
  </body></html>`;
}

// C: Word doc, commercials in paragraphs, USD
async function makeC(out) {
  const v = vendors.C;
  const usd = (n) => `USD ${n.toFixed(3)}`;
  const q = Object.fromEntries(v.quotes.map((x) => [x.lineId, x]));
  const sentence = (ids, intro) => intro + ids.map((id) => `${usd(q[id].rawPrice)} each for the ${size(byId[id])} mm size`).join('; ') + '.';
  const ids = (pred) => lines.filter(pred).map((l) => l.id);
  const p3 = ids((l) => l.kind === 'box' && l.ply === 3);
  const p5 = ids((l) => l.kind === 'box' && l.ply === 5);
  const p7 = ids((l) => l.kind === 'box' && l.ply === 7);
  const ml = ids((l) => l.kind === 'mailer');
  const para = (text, opts = {}) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text, ...opts })] });
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.LEFT, children: [new TextRun('PackGlobal Exports LLP')] }),
          para('Unit 7, Kandla Special Economic Zone, Gandhidham 370230, India'),
          para('16 October 2026'),
          para('Commercial offer for Nimbus Home Care Pvt Ltd against RFQ-2026-PKG-014', { bold: true }),
          para(
            'Dear Team, thank you for inviting us to quote for your annual corrugated packaging requirement. As an export oriented unit we invoice all customers in US dollars, so the prices below are in USD. All prices are per piece, delivered to your Bhiwandi warehouse with freight included. GST is extra.',
          ),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Our prices')] }),
          para(sentence(p3, 'For the 3-ply RSC shipper cartons in brown kraft we can offer ')),
          para(sentence(p5, 'Moving to the 5-ply RSC cartons, our prices are ')),
          para(sentence(p7, 'The heavy duty 7-ply cartons are priced at ')),
          para(sentence(ml, 'For the E-flute die-cut self-locking mailer boxes we offer ')),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('About our quality systems and terms')] }),
          para(`On quality, we are ${v.answers.Q1.text} ${v.answers.Q2.text} ${v.answers.Q3.text}`),
          para(
            `Our lead time from purchase order to delivery is ${v.answers.Q4.text}, and our plant capacity is ${v.answers.Q5.text}. On payment, ${v.answers.Q6.text}. The prices in this offer are valid for ${v.answers.Q7.text}. Our customer rejection rate over the last twelve months has been ${v.answers.Q8.text}.`,
          ),
          para('We look forward to your order.'),
          para('Regards, R. Mehta, Head of Sales, PackGlobal Exports LLP'),
        ],
      },
    ],
  });
  fs.writeFileSync(path.join(out, v.file), await Packer.toBuffer(doc));
}

// D: photo of a printed rate card, at an angle
function htmlD() {
  const v = vendors.D;
  const rows = v.quotes.map((q) => {
    const l = byId[q.lineId];
    const item = l.kind === 'mailer' ? 'Mailer box E-flute' : `${l.ply} Ply box`;
    const rate = l.kind === 'mailer' ? `${q.rawPrice}.00 *` : q.rawPrice.toFixed(2);
    return `<tr><td>${item}</td><td>${size(l)}</td><td class="r">${rate}</td></tr>`;
  });
  const half = Math.ceil(rows.length / 2);
  const tbl = (rs) => `<table><thead><tr><th>Item</th><th>Size (mm)</th><th class="r">Rate / box (Rs)</th></tr></thead><tbody>${rs.join('')}</tbody></table>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; }
  body { background: radial-gradient(ellipse at 30% 20%, #9a7350 0%, #6f4e33 55%, #4a3322 100%); perspective: 2200px; overflow: hidden; }
  .grain { position: absolute; inset: 0; background: repeating-linear-gradient(92deg, rgba(0,0,0,0.05) 0 3px, rgba(255,255,255,0.03) 3px 9px); }
  .paper { position: absolute; left: 190px; top: 70px; width: 1500px; height: 1020px; background: #fbf8f0; box-shadow: 18px 26px 50px rgba(0,0,0,0.5);
    transform: rotateX(19deg) rotateY(-11deg) rotateZ(4.5deg); transform-origin: center; padding: 46px 56px; box-sizing: border-box;
    font-family: Arial, Helvetica, sans-serif; color: #222; filter: blur(0.45px) contrast(0.95); }
  .shade { position: absolute; inset: 0; background: linear-gradient(115deg, rgba(255,255,255,0.18) 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.16) 100%); pointer-events: none; }
  h1 { margin: 0; font-size: 44px; letter-spacing: 3px; color: #8c1c13; }
  .addr { font-size: 19px; color: #444; margin-top: 4px; }
  .title { font-size: 26px; font-weight: bold; margin: 18px 0 10px; border-top: 3px solid #8c1c13; border-bottom: 3px solid #8c1c13; padding: 6px 0; display: flex; justify-content: space-between; }
  .cols { display: flex; gap: 40px; }
  table { border-collapse: collapse; width: 100%; font-size: 23px; }
  th { text-align: left; border-bottom: 2px solid #222; padding: 5px 6px; font-size: 21px; }
  td { border-bottom: 1px solid #bbb; padding: 6.5px 6px; }
  .r { text-align: right; }
  .notes { margin-top: 16px; font-size: 19px; line-height: 1.5; }
  </style></head><body><div class="grain"></div>
  <div class="paper">
    <h1>MARUTI CORRUGATORS</h1>
    <div class="addr">Gala No. 14, Sativali Road, Vasai (E), Palghar 401208 &nbsp;|&nbsp; Mob. 98200 00000</div>
    <div class="title"><span>RATE CARD for Nimbus Home Care (RFQ-2026-PKG-014)</span><span>w.e.f. 12-10-2026</span></div>
    <div class="cols"><div style="flex:1">${tbl(rows.slice(0, half))}</div><div style="flex:1">${tbl(rows.slice(half))}</div></div>
    <div class="notes">* Mailer boxes are packed and sold in boxes of 25 pcs. Mailer rate is per box of 25.<br>
    Rates ex-factory Vasai. Transport and GST extra. All boxes plain brown kraft.</div>
    <div class="shade"></div>
  </div></body></html>`;
}

// E: three-line email
function makeE(out) {
  const text = `From: Prakash Shinde <prakash@saicartons.example>
To: purchase@nimbushomecare.example
Date: Sat, 17 Oct 2026 19:42:10 +0530
Subject: Re: RFQ-2026-PKG-014 corrugated cartons annual rates

Sir,
₹42/kg for the 5-ply, 38 for the 3-ply, rest same as last year, freight extra.
Pls confirm order.

Prakash
Sai Cartons, Bhosari
Sent from my phone
`;
  fs.writeFileSync(path.join(out, vendors.E.file), text);
}

export async function render(out, browser) {
  await makeA(out);
  await makeC(out);
  makeE(out);
  const pageB = await browser.newPage();
  await pageB.setContent(htmlB());
  await pageB.pdf({ path: path.join(out, vendors.B.file), format: 'A4', printBackground: true });
  await pageB.close();
  const pageD = await browser.newPage({ viewport: { width: 1900, height: 1200 }, deviceScaleFactor: 1 });
  await pageD.setContent(htmlD());
  await pageD.screenshot({ path: path.join(out, vendors.D.file), type: 'jpeg', quality: 72 });
  await pageD.close();
}
