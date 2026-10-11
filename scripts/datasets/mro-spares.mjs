// MRO spares dataset: the RFx, last year's prices, what each vendor "really" quoted, and how the
// five reply files are rendered. The vendors object is the answer key. It is written to
// scripts/truth/mro-spares.json and must never reach src/ or public/.
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { mulberry32, money, perfectAnswers, perfectItem, perfectTerms, r2 } from '../lib.mjs';

export const meta = {
  id: 'mro-spares',
  title: 'MRO spares',
  buyer: 'Trishul Forgings Ltd',
  kind: 'Annual rate contract',
  value: '₹25 lakh',
  valueNote: 'a year',
  summary: '30 maintenance spares for a forging plant at Chakan: bearings, belts, seals, filters, switchgear, hoses and consumables, about ₹25 lakh a year.',
  whyCheapestIsWrong: 'No vendor covers the whole list, and some of the lowest prices are for an equivalent brand.',
  edges: [
    'Excel price list with their own part codes and a minimum order column',
    'PDF quotation with "equivalent" makes and lead times in the remarks',
    'Word offer priced per pack, per carton and per metre',
    'Photo of a handwritten counter quote, 12 of 30 lines',
    'Short email: "list less 32%" and "as attached last month", no prices',
  ],
  questions: [
    'What is the smallest set of vendors that covers all 30 lines?',
    'What do the minimum order quantities cost us in the first year?',
    'Which lines only have an equivalent, not the brand we asked for?',
    'What changes if everything has to arrive in 3 weeks?',
    'Which equivalent brands has maintenance approved?',
  ],
};

// [category, item, brand asked for, part number, yearly quantity, last year Rs, metres per piece]
const RAW = [
  ['Bearings', 'Deep groove ball bearing', 'SKF', '6205-2RS1', 240, 310],
  ['Bearings', 'Deep groove ball bearing', 'SKF', '6308-2Z', 120, 1150],
  ['Bearings', 'Spherical roller bearing', 'SKF', '22212 E', 24, 6800],
  ['Bearings', 'Taper roller bearing', 'SKF', '32210', 36, 2450],
  ['Bearings', 'Angular contact ball bearing', 'SKF', '7208 BECBP', 30, 3200],
  ['Bearings', 'Pillow block bearing unit', 'SKF', 'UCP 208', 40, 1900],
  ['Bearings', 'Needle roller bearing', 'SKF', 'NK 30/20', 60, 780],
  ['Bearings', 'Cylindrical roller bearing', 'SKF', 'NU 2210 ECP', 18, 4300],
  ['Belts and seals', 'Classical V-belt', 'Fenner', 'B-68', 150, 420],
  ['Belts and seals', 'Wedge V-belt', 'Fenner', 'SPB 2500', 60, 1350],
  ['Belts and seals', 'Timing belt', 'Gates', 'HTD 1200-8M-30', 20, 2900],
  ['Belts and seals', 'Oil seal, NBR', 'SKF', '45x62x8 HMSA10', 200, 95],
  ['Belts and seals', 'Oil seal, FKM', 'SKF', '80x100x10 HMSA10 V', 80, 480],
  ['Belts and seals', 'Mechanical seal, 35 mm', 'Eagle Burgmann', 'M21-35', 12, 3600],
  ['Filters', 'Hydraulic return filter element', 'Fleetguard', 'HF6553', 48, 1450],
  ['Filters', 'Compressor oil filter', 'Atlas Copco', '1613 6105 00', 24, 2100],
  ['Filters', 'Compressor air filter element', 'Donaldson', 'P181099', 30, 3900],
  ['Filters', 'Coolant filter bag, 25 micron, size 2', 'Eaton', 'PO-25-P2P', 300, 240],
  ['Electrical', 'Power contactor, 32 A, 220 V coil', 'Schneider', 'LC1D32M7', 30, 2750],
  ['Electrical', 'Thermal overload relay, 23 to 32 A', 'Schneider', 'LRD32', 30, 1650],
  ['Electrical', 'Limit switch, roller lever', 'Schneider', 'XCKJ10511', 40, 1250],
  ['Electrical', 'Inductive proximity sensor, M18, PNP NO', 'IFM', 'IF5932', 50, 1800],
  ['Electrical', 'Miniature circuit breaker, 32 A, 3 pole, C curve', 'Schneider', 'A9F44332', 60, 1100],
  ['Hydraulics', 'Hydraulic hose assembly, 1/2 inch 2SN, 1.5 metre, BSP both ends', 'Gates', 'M2T-08 1500', 80, 980, 1.5],
  ['Hydraulics', 'Hydraulic hose assembly, 3/4 inch 2SN, 2 metre, BSP both ends', 'Gates', 'M2T-12 2000', 40, 1720, 2],
  ['Hydraulics', 'Quick release coupling, 1/2 inch BSP, ISO B', 'Parker', '6601-8-10', 60, 640],
  ['Consumables', 'Nitrile coated work gloves, size 9, per pair', 'Midas', 'NFT-9', 6000, 38],
  ['Consumables', 'Cut-resistant gloves, level 5, per pair', 'Midas', 'CR5-9', 1200, 210],
  ['Consumables', 'Lithium EP2 grease, 1 kg tin', 'Servo', 'Gem EP2 1kg', 180, 340],
  ['Consumables', 'PTFE thread seal tape, 12 mm x 10 m roll', 'Champion', 'PT-1210', 2400, 14],
];

const lines = RAW.map(([category, item, brand, part, quantity, lastYear, metre], i) => ({
  id: `L${String(i + 1).padStart(2, '0')}`,
  category,
  item,
  brand,
  part,
  description: `${item}, ${brand} ${part}`,
  spec: `${brand} ${part}`,
  quantity,
  lastYear,
  metre: metre ?? null,
}));
const byId = Object.fromEntries(lines.map((l) => [l.id, l]));

const questionnaire = [
  { id: 'Q1', gate: true, text: 'Are you an authorised distributor or stockist for every brand you quote as original? Name the brands and cite the authorisation.' },
  { id: 'Q2', gate: true, text: 'Will you hold stock of the fast-moving lines within 100 km of Chakan and deliver a call-off for them inside 3 working days?' },
  { id: 'Q3', gate: true, text: 'Will you give the manufacturer invoice or a certificate of genuineness for bearings and seals when we ask?' },
  { id: 'Q4', gate: false, text: 'Do you accept payment 45 days from delivery?' },
  { id: 'Q5', gate: false, text: 'Will you hold the quoted prices for the full contract year?' },
  { id: 'Q6', gate: false, text: 'Will you take back unused items in original packing?' },
  { id: 'Q7', gate: false, text: 'Can you supply a breakdown item the same day, and at what charge?' },
  { id: 'Q8', gate: false, text: 'How many plants do you supply on an annual rate contract today?' },
];

export const rfx = {
  id: 'RFQ-2026-MRO-052',
  title: 'Annual rate contract: maintenance spares, Chakan plant',
  buyer: 'Trishul Forgings Ltd',
  scope: 'Rate contract for maintenance, repair and operating spares for our forging plant at Chakan, Pune, for one year. Call-offs through the year against the quantities shown. Quote the brand and part number on each line. If you offer another make, say so against the line.',
  currency: 'INR',
  period: 'year',
  quantityLabel: 'Quantity a year',
  refLabel: 'last year',
  attributes: [{ key: 'lead_time_days', label: 'Lead time', unit: 'days', better: 'lower' }],
  lineItems: lines.map((l) => ({ id: l.id, description: l.description, spec: l.spec, category: l.category, measures: l.metre ? { metre: l.metre } : {}, quantity: l.quantity, unit: 'piece', refPrice: l.lastYear })),
  questionnaire,
  terms: {
    priceBasis: 'Per piece (per pair for gloves), in INR, delivered to our stores at Chakan, GST shown separately',
    delivery: 'Call-offs through the year. State the lead time and any minimum order quantity per line.',
    brand: 'Quote the make asked for. An equivalent may be offered and must be marked as one.',
    payment: '45 days from delivery',
    responseDue: '2026-10-28',
  },
};

// ---- What each vendor really quoted ----
const roundTo = (n, step) => Math.round(n / step) * step;
const nice = (n) => (n >= 1000 ? roundTo(n, 10) : n >= 100 ? roundTo(n, 5) : roundTo(n, 0.5));
function priced(seed, factor, noise, ids) {
  const rnd = mulberry32(seed);
  const all = Object.fromEntries(lines.map((l) => [l.id, l.lastYear * factor * (1 + (rnd() * 2 - 1) * noise)]));
  return ids.map((id) => [id, all[id]]);
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `L${String(a + i).padStart(2, '0')}`);

// A: Excel price list from an authorised distributor. Their own part codes, a minimum order column
// in pieces, delivery in days. Bearings, belts, seals and filters. Four minimums are above the yearly need.
const A_MOQ = { L01: 20, L02: 10, L03: 30, L04: 6, L05: 6, L06: 4, L07: 10, L08: 20, L09: 10, L10: 5, L11: 25, L12: 50, L13: 20, L14: 20, L15: 6, L16: 4, L17: 2, L18: 50 };
const A_LEAD = { L03: 21, L08: 21, L14: 28 };
const vendorA = priced(11, 1.02, 0.03, range(1, 18)).map(([id, p]) => {
  const l = byId[id];
  const raw = nice(p);
  return { lineId: id, rawPrice: raw, unitInr: raw, moq: A_MOQ[id], moqUnits: A_MOQ[id], leadDays: A_LEAD[id] ?? (l.category === 'Bearings' ? 7 : l.category === 'Filters' ? 10 : 5) };
});

// B: PDF quotation. Genuine makes on most lines, an "equivalent" make on six, said so in the
// remarks column along with the lead time. The imported bearing is 10 weeks.
const B_IDS = ['L02', 'L03', 'L05', 'L08', 'L09', 'L10', 'L15', 'L16', 'L17', 'L18', 'L19', 'L20', 'L21', 'L22', 'L23', 'L24', 'L26'];
const B_SUBS = {
  L03: 'ZKL 22212 EW33J, offered as equivalent to SKF 22212 E',
  L05: 'ZKL 7208 BETNG, offered as equivalent to SKF 7208 BECBP',
  L08: 'ZKL NU 2210, offered as equivalent to SKF NU 2210 ECP',
  L16: 'Filtrec A140C10 compressor oil filter, offered as equivalent to Atlas Copco 1613 6105 00',
  L19: 'L&T MO 32 contactor, 220 V coil, offered as equivalent to Schneider LC1D32M7',
  L22: 'Omron E2B-M18KS08-WP-B1 sensor, offered as equivalent to IFM IF5932',
};
const B_LEAD = { L02: [70, '10 weeks, imported'], L24: [7, '1 week'], L26: [7, '1 week'] };
const vendorB = priced(22, 0.985, 0.03, B_IDS).map(([id, p]) => {
  const l = byId[id];
  const sub = B_SUBS[id] ?? null;
  const raw = nice(p * (sub ? 0.74 : 1));
  const lead = B_LEAD[id] ?? (sub ? [14, '2 weeks'] : l.category === 'Electrical' ? [3, 'Ex-stock, 3 days'] : [14, '2 weeks']);
  return { lineId: id, rawPrice: raw, unitInr: raw, substitute: sub, leadDays: lead[0], leadText: lead[1] };
});

// C: Word offer. Consumables by the pack or carton, seals by the pack, hose by the metre.
// One carton minimum is above the yearly need. Delivery 10 days on everything.
const C_IDS = ['L12', 'L13', 'L14', 'L15', 'L18', 'L24', 'L25', 'L26', 'L27', 'L28', 'L29', 'L30'];
const C_PACK = { L12: [10, 'per pack of 10 seals'], L27: [12, 'per pack of 12 pairs'], L28: [12, 'per pack of 12 pairs'], L29: [12, 'per carton of 12 tins'], L30: [10, 'per box of 10 rolls'] };
const C_MOQ_PACKS = { L29: 20 };
const vendorC = priced(33, 1.0, 0.035, C_IDS).map(([id, p]) => {
  const l = byId[id];
  if (C_PACK[id]) {
    const [n, unitText] = C_PACK[id];
    const raw = roundTo(p * n, n >= 12 ? 5 : 1);
    const moq = C_MOQ_PACKS[id] ?? null;
    return { lineId: id, rawPrice: raw, pack: n, unitText, unitInr: r2(raw / n), moq, moqUnits: moq ? moq * n : null };
  }
  if (l.metre) {
    const raw = roundTo(p / l.metre, 5);
    return { lineId: id, rawPrice: raw, measure: 'metre', unitText: 'per metre of assembled length', unitInr: r2(raw * l.metre) };
  }
  const raw = nice(p);
  return { lineId: id, rawPrice: raw, unitInr: raw };
});

// D: a handwritten counter quote, photographed. 12 lines, the cheapest prices, two by the box.
// Nothing on the questionnaire, and delivery is not in the price.
const D_IDS = ['L01', 'L02', 'L04', 'L06', 'L07', 'L09', 'L10', 'L12', 'L27', 'L28', 'L29', 'L30'];
const D_PACK = { L01: 10, L30: 10 };
const vendorD = priced(44, 0.9, 0.03, D_IDS).map(([id, p]) => {
  if (D_PACK[id]) {
    const raw = roundTo(p * D_PACK[id], id === 'L30' ? 1 : 10);
    return { lineId: id, rawPrice: raw, pack: D_PACK[id], unitText: 'per box of 10', unitInr: r2(raw / D_PACK[id]) };
  }
  const raw = nice(p);
  return { lineId: id, rawPrice: raw, unitInr: raw };
});

export const vendors = {
  A: {
    id: 'A',
    name: 'Prime Bearings and Transmission Pvt Ltd',
    file: 'vendor-a-prime-price-list.xlsx',
    format: 'Excel',
    hard: 'A distributor price list under their own part codes. Read the minimum order column as well as the rate.',
    quotes: vendorA,
    terms: { freight: 'included', gst: 'extra', discountPct: 0, validity: '31 March 2027' },
    answers: {
      Q1: { meets: 'yes', text: 'Yes. Authorised industrial distributor for SKF, and authorised stockist for Fenner, Gates, Eagle Burgmann, Fleetguard, Atlas Copco, Donaldson and Eaton filtration. Certificates enclosed.' },
      Q2: { meets: 'yes', text: 'Yes. Our Bhosari warehouse is 22 km from your plant. Fast-moving lines are delivered within 2 working days of a call-off.' },
      Q3: { meets: 'yes', text: 'Yes. Manufacturer invoice copy and SKF Authenticate check on request, for every bearing and seal.' },
      Q4: { meets: 'na', text: 'Accepted, 45 days from delivery.' },
      Q5: { meets: 'na', text: 'Prices held until 31 March 2027. After that, as per the manufacturer list price revision.' },
      Q6: { meets: 'na', text: 'Yes, within 60 days, in original packing, 10% restocking charge.' },
      Q7: { meets: 'na', text: 'Same-day breakdown supply from Bhosari stock at no extra charge during working hours.' },
      Q8: { meets: 'na', text: '14 plants in the Chakan and Ranjangaon belt.' },
    },
  },
  B: {
    id: 'B',
    name: 'Ashoka Industrial Supplies',
    file: 'vendor-b-ashoka-quotation.pdf',
    format: 'PDF',
    hard: 'A quotation with a make column and a remarks column. The make offered is not always the make asked for, and the lead time is in the remarks.',
    quotes: vendorB,
    terms: { freight: 'included', gst: 'extra', discountPct: 0, validity: '60 days' },
    answers: {
      Q1: { meets: 'yes', text: 'Yes. We are authorised stockists for Schneider Electric, Fenner, Fleetguard, Donaldson, Eaton, Gates and Parker, and an authorised SKF sub-distributor. Where we have offered ZKL, Filtrec, L&T or Omron we are authorised for those makes as well. Letters attached.' },
      Q2: { meets: 'yes', text: 'Yes. Stock is held at our Pimpri godown, 30 km from Chakan. Fast-moving lines are delivered within 3 working days.' },
      Q3: { meets: 'yes', text: 'Yes, manufacturer invoice copies will be given for bearings and seals on request.' },
      Q4: { meets: 'na', text: 'We request 30 days. 45 days is acceptable for monthly billing above Rs 1 lakh.' },
      Q5: { meets: 'na', text: 'Prices are firm for 60 days and then subject to manufacturer revisions.' },
      Q6: { meets: 'na', text: 'Unused items are taken back within 30 days.' },
      Q7: { meets: 'na', text: 'Same-day supply for electrical items in stock. Rs 500 per trip for breakdown delivery.' },
      Q8: { meets: 'na', text: '9 plants.' },
    },
  },
  C: {
    id: 'C',
    name: 'Hydroflex Engineering and Safety',
    file: 'vendor-c-hydroflex-offer.docx',
    format: 'Word',
    hard: 'Prices sit inside paragraphs. Several are for a pack, a carton or a metre, not for one piece, and one has a minimum order.',
    quotes: vendorC,
    leadDaysAll: 10,
    terms: { freight: 'included', gst: 'extra', discountPct: 0, validity: 'the contract year' },
    answers: {
      Q1: { meets: 'yes', text: 'we are authorised distributors for Gates hose and Parker couplings, and authorised stockists for SKF seals, Eagle Burgmann, Fleetguard, Eaton, Midas, Servo and Champion' },
      Q2: { meets: 'yes', text: 'we hold stock at Talegaon, 18 km from your plant, and deliver call-offs of fast-moving lines within 3 working days' },
      Q3: { meets: 'yes', text: 'manufacturer invoices for seals are shared whenever you ask' },
      Q4: { meets: 'na', text: '45 days from delivery is fine' },
      Q5: { meets: 'na', text: 'the prices hold for the full contract year' },
      Q6: { meets: 'na', text: 'unopened packs are taken back, cut hose is not' },
      Q7: { meets: 'na', text: 'hose assemblies can be crimped and sent the same day at no extra charge' },
      Q8: { meets: 'na', text: 'six plants' },
    },
  },
  D: {
    id: 'D',
    name: 'Laxmi Mill Stores',
    file: 'vendor-d-laxmi-counter-quote.jpg',
    format: 'Photo',
    hard: 'A photo of a handwritten counter quote. Only some lines are on it, the items are written short, and two rates are for a box.',
    quotes: vendorD,
    leadDaysAll: 1,
    terms: { freight: 'extra', gst: 'extra', discountPct: 0, validity: 'not stated' },
    answers: null,
  },
  E: {
    id: 'E',
    name: 'Deccan Bearing Agencies',
    file: 'vendor-e-deccan-email.txt',
    format: 'Email',
    hard: 'Two sentences. No price is written. One points at a list price and the other at a quote sent last month.',
    quotes: [],
    // Only the first gate question is answered, so the gate is unclear, not passed.
    gate: 'unclear',
    terms: { freight: 'not_stated', gst: 'not stated', discountPct: 0, validity: 'not stated' },
    answers: {
      Q1: { meets: 'yes', text: 'We are SKF authorised distributor since 1998.' },
    },
  },
};

// What the grid should show per line with default decisions.
export const expected = (v) => Object.fromEntries(v.quotes.map((q) => [q.lineId, q.unitInr]));

const attr = (key, n, text) => ({ key, value_number: n, value_text: text ?? String(n), quote: 'selftest' });

export function perfectExtraction(v) {
  const items = v.quotes.map((q) =>
    perfectItem({
      lineId: q.lineId,
      price: q.rawPrice,
      basis: q.pack ? 'per_n_units' : q.measure ? 'per_measure' : 'per_unit',
      pack: q.pack ?? null,
      measure: q.measure ?? '',
      unitText: q.unitText ?? 'each',
      match: q.substitute ? 'substitute' : 'exact',
      offered: q.substitute ?? '',
      moq: q.moq ?? null,
      attributes: q.leadDays != null ? [attr('lead_time_days', q.leadDays, q.leadText)] : [],
    }),
  );
  const refs =
    v.id === 'E'
      ? [
          { kind: 'other', scope: 'listed_lines', line_ids: range(1, 8), excluded_line_ids: [], adjustment_percent: null, quote: 'All SKF bearings at list less 32%', note: 'No list price is in the file, so no price can be worked out.' },
          { kind: 'other', scope: 'all_lines_not_otherwise_quoted', line_ids: [], excluded_line_ids: [], adjustment_percent: null, quote: 'others as per our quote attached last month', note: 'The earlier quote is not in this file.' },
        ]
      : [];
  return {
    vendor_name: v.name,
    items,
    references: refs,
    vendor_attributes: v.leadDaysAll ? [attr('lead_time_days', v.leadDaysAll)] : [],
    answers: perfectAnswers(rfx, v.answers),
    terms: perfectTerms(v.terms),
    document_notes: [],
  };
}

// Every non-empty subset of the vendors, smallest first.
function subsets(xs) {
  const out = [];
  for (let m = 1; m < 1 << xs.length; m++) out.push(xs.filter((_, i) => m & (1 << i)));
  return out.sort((a, b) => a.length - b.length);
}

export function checks(grid, h) {
  const out = [];
  const amber = grid.vendors.reduce((n, v) => n + v.counts.look, 0);
  out.push(`rules to accept: ${grid.rules.filter((r) => !r.accepted).length} (expected 6), amber cells: ${amber} (expected 6, the equivalents), shared lines: ${grid.commonLineIds.length} (expected 0)`);
  const cleared = Object.values(vendors).filter((v) => v.answers && !v.gate && !Object.values(v.answers).some((a) => a.meets === 'no'));
  const gated = { eligible_vendors: 'passed_quality_gate' };

  // Coverage: the fewest gate-cleared vendors that price every line.
  const few = h.awardScenario(grid, { ...gated, fewest_vendors: true });
  const cover = subsets(cleared).find((set) => lines.every((l) => set.some((v) => v.quotes.some((q) => q.lineId === l.id))));
  out.push(`Fewest gate-cleared vendors that cover everything: app ${few.vendors_in_award.length} vendors (${few.vendors_in_award.map((x) => x.vendor_id).join('+')}), ${few.lines_awarded} of ${few.lines_total} lines`);
  out.push(`  hand, from the answer key: ${cover ? `${cover.length} vendors (${cover.map((v) => v.id).join('+')})` : 'no set covers all lines'}  ${cover && cover.length === few.vendors_in_award.length && few.lines_awarded === lines.length ? 'MATCH' : 'DIFFERENT'}`);

  // Minimum orders: cheapest per line among gate-cleared vendors, paying for the minimum where it is above the need.
  const any = h.awardScenario(grid, gated);
  let hand = 0;
  let handExtra = 0;
  for (const l of lines) {
    const opts = cleared
      .map((v) => v.quotes.find((q) => q.lineId === l.id))
      .filter(Boolean)
      .map((q) => ({ cost: q.unitInr * Math.max(l.quantity, q.moqUnits ?? 0), extra: q.unitInr * Math.max(0, (q.moqUnits ?? 0) - l.quantity) }))
      .sort((a, b) => a.cost - b.cost);
    hand += Math.round(opts[0].cost * 100) / 100;
    handExtra += opts[0].extra;
  }
  out.push(`Cheapest per line, gate-cleared (${any.eligible_vendors.length} vendors): ${any.total_cost}, of which minimum orders add ${any.minimum_order_extra_cost}`);
  out.push(`  hand calculation (${cleared.map((v) => v.id).join('+')}): ${hand.toFixed(2)}, minimums add ${handExtra.toFixed(2)}  ${Math.abs(hand - any.total_cost) < 1 && Math.abs(handExtra - any.minimum_order_extra_cost) < 1 ? 'MATCH' : 'DIFFERENT'}`);
  const moqRules = grid.rules.filter((r) => r.code === 'moq');
  out.push(`  minimum order rules: ${moqRules.map((r) => `${r.replyId} on ${r.lineIds.join(',')} adds ${r.amount}`).join(' | ')}`);

  // Equivalents: lines where no gate-cleared vendor offers the make asked for.
  const exact = h.awardScenario(grid, { ...gated, exact_match_only: true });
  const onlyEquiv = lines.filter((l) => !cleared.some((v) => v.quotes.some((q) => q.lineId === l.id && !q.substitute))).map((l) => l.id);
  out.push(`Exact make only: ${exact.total_cost} over ${exact.lines_awarded} lines. Lines with no exact make: app ${exact.lines_without_an_eligible_price.join(',')} | answer key ${onlyEquiv.join(',')}  ${exact.lines_without_an_eligible_price.join(',') === onlyEquiv.join(',') ? 'MATCH' : 'DIFFERENT'}`);

  // Lead time: everything within 3 weeks.
  const fast = h.awardScenario(grid, { ...gated, require: [{ attribute: 'lead_time_days', op: 'max', value: 21 }] });
  const moved = fast.awards.filter((a) => any.awards.find((b) => b.line === a.line)?.vendor_id !== a.vendor_id).map((a) => a.line);
  out.push(`Within 21 days: ${fast.total_cost} over ${fast.lines_awarded} lines. Lines that changed vendor: ${moved.join(', ') || 'NONE'}. Lines with no price: ${fast.lines_without_an_eligible_price.join(', ') || 'none'}`);
  const e = grid.vendors.find((v) => v.replyId === 'E');
  out.push(`E, the email with no prices: ${e ? `${e.linesQuoted} lines priced, gate ${e.gate}, notes: ${e.notes.length}` : 'NOT READ'} (expected 0 lines, gate unclear, 2 notes)`);
  return out;
}

// ---------- Rendering the five reply files ----------
async function makeA(out) {
  const v = vendors.A;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Price list');
  ws.columns = [{ width: 5 }, { width: 16 }, { width: 46 }, { width: 14 }, { width: 8 }, { width: 14 }, { width: 14 }, { width: 16 }];
  [
    ['PRIME BEARINGS AND TRANSMISSION PVT LTD'],
    ['Plot 71, J Block, MIDC Bhosari, Pune 411026 | GSTIN 27AAACP4321L1Z9 | sales@primebearings.example'],
    ['Price list PBT/RC/2026/118        Date: 22-10-2026'],
    ['To: Trishul Forgings Ltd, Chakan.   Ref: your enquiry RFQ-2026-MRO-052'],
  ].forEach((r, i) => {
    ws.getRow(i + 1).values = r;
    if (i === 0) ws.getRow(1).font = { bold: true, size: 15, color: { argb: 'FF7A1F1F' } };
  });
  const head = ws.getRow(6);
  head.values = ['Sr', 'Prime code', 'Description', 'Make', 'UOM', 'Rate (Rs)', 'Min. order (Nos)', 'Delivery (days)'];
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7A1F1F' } }));
  // Their own order: by make, then by part number.
  const rows = [...v.quotes].sort((a, b) => (byId[a.lineId].brand + byId[a.lineId].part).localeCompare(byId[b.lineId].brand + byId[b.lineId].part));
  rows.forEach((q, i) => {
    const l = byId[q.lineId];
    const row = ws.getRow(7 + i);
    row.values = [i + 1, `PB-${l.brand.slice(0, 2).toUpperCase()}${4000 + Number(l.id.slice(1)) * 13}`, `${l.item} ${l.part}`, l.brand, 'Nos', q.rawPrice, q.moq, q.leadDays];
    row.getCell(6).numFmt = '#,##0.00';
  });
  const n = 7 + rows.length + 1;
  [
    'Terms:',
    '1. Rates are per piece in Indian Rupees, delivered to your stores at Chakan. Freight included. GST extra as applicable.',
    '2. Min. order is the least quantity we supply against one call-off of that item.',
    '3. Rates valid up to 31 March 2027.',
    '4. All items are genuine, in the make shown.',
  ].forEach((t, i) => (ws.getRow(n + i).values = [t]));
  const comp = wb.addWorksheet('Your questions');
  comp.columns = [{ width: 60 }, { width: 100 }];
  comp.getRow(1).values = ['Your question', 'Our reply'];
  comp.getRow(1).font = { bold: true };
  questionnaire.forEach((q, i) => (comp.getRow(2 + i).values = [q.text, v.answers[q.id].text]));
  await wb.xlsx.writeFile(path.join(out, v.file));
}

function htmlB() {
  const v = vendors.B;
  const rows = v.quotes
    .map((x, i) => {
      const l = byId[x.lineId];
      const make = x.substitute ? x.substitute.split(',')[0] : `${l.brand} ${l.part}`;
      const remark = `${x.leadText}${x.substitute ? '. Equivalent make offered.' : ''}`;
      return `<tr><td>${i + 1}</td><td>${l.item}, ${l.brand} ${l.part}</td><td>${make}</td><td class="r">${l.quantity.toLocaleString('en-IN')}</td><td class="r">${money(x.rawPrice, 2)}</td><td>${remark}</td></tr>`;
    })
    .join('');
  const qa = questionnaire.map((q, i) => `<p class="qa"><b>${i + 1}. ${q.text}</b><br>${v.answers[q.id].text}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 15mm 13mm 16mm 13mm; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 9.5pt; color: #1e1e1e; }
  .lh { border-bottom: 3px double #5b3a1a; padding-bottom: 8px; margin-bottom: 12px; text-align: center; }
  .lh h1 { margin: 0; font-size: 20pt; color: #5b3a1a; letter-spacing: 1px; }
  .lh .sub { font-size: 8pt; color: #555; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #5b3a1a; color: #fff; text-align: left; padding: 4px 5px; font-size: 8.5pt; }
  td { border: 1px solid #c9c2b8; padding: 3px 5px; font-size: 8.5pt; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; }
  .fn { font-size: 8pt; color: #444; margin-top: 8px; line-height: 1.45; }
  .qa { margin: 7px 0; }
  h2 { font-size: 12pt; color: #5b3a1a; margin-top: 16px; }
  </style></head><body>
  <div class="lh"><h1>ASHOKA INDUSTRIAL SUPPLIES</h1>
  <div class="sub">Electricals · Bearings · Filtration · Hydraulics<br>Shop 7 to 9, Morwadi Road, Pimpri, Pune 411018 · GSTIN 27AAHFA9087B1Z2 · ashokaindustrial@example.in</div></div>
  <p><b>Quotation AIS/26-27/Q-0932</b> &nbsp;·&nbsp; 23 October 2026 &nbsp;·&nbsp; Your enquiry: RFQ-2026-MRO-052</p>
  <p>Kind attention: Stores and Purchase, Trishul Forgings Ltd, Chakan. We thank you for the enquiry and quote our best rates as under.</p>
  <table><thead><tr><th style="width:4%">Sr</th><th style="width:30%">Item as per your enquiry</th><th style="width:20%">Make offered</th><th class="r" style="width:8%">Qty / year</th><th class="r" style="width:12%">Rate each (Rs)</th><th>Remarks</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="fn">Rates are per piece, in Indian Rupees, delivered to your Chakan stores, freight included. GST extra. Where the make offered differs from the make in your enquiry, it is an equivalent and is marked in the remarks. Items not listed above are not in our range. Validity of this quotation: 60 days.</div>
  <h2 style="page-break-before: always">Annexure: replies to your supplier questionnaire</h2>
  ${qa}
  <p style="margin-top:24px">For Ashoka Industrial Supplies<br><br><br>Partner</p>
  </body></html>`;
}

async function makeC(out) {
  const v = vendors.C;
  const q = Object.fromEntries(v.quotes.map((x) => [x.lineId, x]));
  const rs = (n) => `Rs ${money(n, n % 1 ? 2 : 0)}`;
  const phrase = (id) => {
    const l = byId[id];
    const x = q[id];
    const name = `${l.item.charAt(0).toLowerCase()}${l.item.slice(1)} (${l.brand} ${l.part})`;
    if (x.pack) return `${name} at ${rs(x.rawPrice)} ${x.unitText}${x.moq ? `, with a minimum order of ${x.moq} cartons against any call-off` : ''}`;
    if (x.measure) return `${name} at ${rs(x.rawPrice)} per metre of assembled length, end fittings included`;
    return `${name} at ${rs(x.rawPrice)} each`;
  };
  const sentence = (intro, ids) => intro + ids.map(phrase).join('; ') + '.';
  const para = (text, opts = {}) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text, ...opts })] });
  const a = v.answers;
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Hydroflex Engineering and Safety')] }),
          para('Gat No. 412, Talegaon Chakan Road, Talegaon Dabhade, Pune 410507'),
          para('24 October 2026'),
          para('Offer against your enquiry RFQ-2026-MRO-052, annual rate contract for maintenance spares', { bold: true }),
          para('Dear Sir, thank you for the enquiry. We have quoted for the hydraulic, sealing, filtration and consumable items, which are our lines. We have not quoted for bearings, belts and electrical items. All prices are in Indian Rupees, delivered to your Chakan stores with freight included. GST is extra.'),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Our prices')] }),
          para(sentence('For hydraulics, we offer the ', ['L24', 'L25', 'L26'])),
          para(sentence('For sealing, we offer the ', ['L12', 'L13', 'L14'])),
          para(sentence('For filtration, we offer the ', ['L15', 'L18'])),
          para(sentence('For consumables, we offer the ', ['L27', 'L28', 'L29', 'L30'])),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Delivery and your questionnaire')] }),
          para('Delivery is 10 days from call-off for all items quoted.'),
          para(`On your questionnaire: ${a.Q1.text}; ${a.Q2.text}; and ${a.Q3.text}. On payment, ${a.Q4.text}. Also, ${a.Q5.text}. On returns, ${a.Q6.text}. For breakdowns, ${a.Q7.text}. We presently serve ${a.Q8.text} on annual rate contracts.`),
          para('Assuring you of our best service.'),
          para('Yours faithfully, Sandeep Kulkarni, Hydroflex Engineering and Safety'),
        ],
      },
    ],
  });
  fs.writeFileSync(path.join(out, v.file), await Packer.toBuffer(doc));
}

function htmlD() {
  const v = vendors.D;
  const short = (l) => `${l.part} ${l.item.replace(/, per pair/, '').replace(/^(Deep groove ball|Taper roller|Needle roller|Pillow block) bearing( unit)?/, 'brg').replace('Classical V-belt', 'V belt').replace('Wedge V-belt', 'V belt').replace('Nitrile coated work gloves, size 9', 'nitrile gloves pair').replace('Cut-resistant gloves, level 5', 'cut gloves L5 pair').replace('Lithium EP2 grease, 1 kg tin', 'EP2 grease 1 kg').replace('PTFE thread seal tape, 12 mm x 10 m roll', 'teflon tape').replace('Oil seal, NBR', 'oil seal')}`;
  const rows = v.quotes
    .map((x, i) => {
      const l = byId[x.lineId];
      return `<div class="row"><span>${i + 1}) ${short(l)} (${l.brand})</span><span class="amt">${money(x.rawPrice, x.rawPrice % 1 ? 2 : 0)}${x.pack ? ` / box of ${x.pack}` : ''}</span></div>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; }
  body { background: linear-gradient(150deg, #5a4632 0%, #3b2d20 70%, #2a2018 100%); perspective: 2600px; overflow: hidden; }
  .paper { position: absolute; left: 430px; top: 40px; width: 980px; height: 1120px; background: #fbf8ee; box-shadow: -10px 20px 40px rgba(0,0,0,0.55);
    transform: rotateX(11deg) rotateY(-8deg) rotateZ(3.5deg); padding: 34px 48px; box-sizing: border-box; color: #17255a; filter: blur(0.35px) contrast(0.95);
    background-image: repeating-linear-gradient(#fbf8ee 0 47px, #c9d6ea 47px 48px); }
  .shade { position: absolute; inset: 0; background: linear-gradient(110deg, rgba(0,0,0,0.16) 0%, rgba(0,0,0,0) 40%, rgba(255,255,255,0.14) 100%); pointer-events: none; }
  .head { font-family: Arial, sans-serif; color: #8a1c1c; text-align: center; border-bottom: 2px solid #8a1c1c; padding-bottom: 6px; margin-bottom: 14px; }
  .head b { font-size: 34px; letter-spacing: 1px; } .head div { font-size: 16px; color: #444; }
  .hand { font-family: 'Bradley Hand', 'Noteworthy', 'Segoe Print', 'Comic Sans MS', cursive; font-size: 29px; line-height: 48px; font-weight: 600; }
  .row { display: flex; justify-content: space-between; gap: 20px; }
  .amt { white-space: nowrap; }
  </style></head><body>
  <div class="paper">
    <div class="head"><b>LAXMI MILL STORES</b><div>Bearings, V-belts, Hardware and Safety Items &nbsp;|&nbsp; Nehru Chowk, Chakan &nbsp;|&nbsp; Estimate / Quotation</div></div>
    <div class="hand">
      <div class="row"><span>M/s Trishul Forgings</span><span>25/10/26</span></div>
      <div>Rates each, in Rs:</div>
      ${rows}
      <div>All genuine, make as written. Ready stock, next day delivery.</div>
      <div>GST extra. Tempo charges extra. Other items not with us.</div>
    </div>
    <div class="shade"></div>
  </div></body></html>`;
}

function makeE(out) {
  const v = vendors.E;
  const text = `From: Deccan Bearing Agencies <sales@deccanbearing.example>
To: stores@trishulforgings.example
Date: Mon, 26 Oct 2026 18:42:10 +0530
Subject: Re: RFQ-2026-MRO-052 annual rate contract

Dear Sir,
All SKF bearings at list less 32%, others as per our quote attached last month.
${v.answers.Q1.text}

Regards
Deccan Bearing Agencies, Pune
`;
  fs.writeFileSync(path.join(out, v.file), text);
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
  await pageD.screenshot({ path: path.join(out, vendors.D.file), type: 'jpeg', quality: 76 });
  await pageD.close();
}
