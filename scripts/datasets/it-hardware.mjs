// IT hardware dataset: a one-time office refresh. The vendors object is the answer key. It is
// written to scripts/truth/it-hardware.json and must never reach src/ or public/.
// Why "cheapest" is wrong here: the cheapest prices are for substitute models.
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { FX_USD_INR, mulberry32, money, perfectAnswers, perfectItem, perfectTerms, r2 } from '../lib.mjs';

export const meta = {
  id: 'it-hardware',
  title: 'IT hardware refresh',
  buyer: 'Lumen Analytics Pvt Ltd',
  kind: 'One-time purchase',
  value: '₹4 crore',
  valueNote: 'one time',
  summary: 'Laptops, desktops, monitors, docks, peripherals, network gear and UPS for a new Bengaluru office, about ₹4 crore.',
  whyCheapestIsWrong: 'The cheapest prices are for substitute models.',
  edges: [
    'Excel with several sheets and price breaks by quantity',
    'PDF where the 3-year warranty is a separate add-on per item',
    'Word doc in USD that offers "equivalent" models on some lines',
    'Photo of a printed price list, 22 of 30 lines, some priced per pack of 10',
    'Short email: "10% off our last PO rates for laptops"',
  ],
  questions: [
    'Cheapest per line among vendors who cleared the quality gate, counting only exact-match models.',
    'Which lines got a substitute, and what does the exact model cost elsewhere?',
    'What changes if everything has to arrive in 21 days?',
    'What does a 3-year warranty add, by vendor?',
    'If we buy 600 standard laptops instead of 400, does the winner on that line change?',
    'Which vendor has the fewest warranty claims?',
  ],
};

// [category, description, short spec, quantity, last PO price Rs, quantity is fixed (not scaled)]
const RAW = [
  ['Laptops', 'Business laptop 14 inch, Intel Core Ultra 5, 16 GB RAM, 512 GB SSD, Windows 11 Pro', '14 in, Ultra 5, 16 GB, 512 GB', 400, 46000, true],
  ['Laptops', 'Performance laptop 14 inch, Intel Core Ultra 7, 32 GB RAM, 1 TB SSD, Windows 11 Pro', '14 in, Ultra 7, 32 GB, 1 TB', 60, 98000, true],
  ['Laptops', 'Developer laptop 16 inch, Intel Core Ultra 9, 32 GB RAM, 1 TB SSD, 8 GB discrete graphics, Windows 11 Pro', '16 in, Ultra 9, 32 GB, 1 TB, dGPU', 20, 165000, true],
  ['Desktops', 'Small form factor desktop, Intel Core i5, 16 GB RAM, 512 GB SSD, Windows 11 Pro', 'SFF, i5, 16 GB, 512 GB', 40, 52000],
  ['Desktops', 'Tower workstation, Intel Xeon W, 64 GB RAM, 2 TB SSD, 16 GB professional graphics', 'Tower, Xeon W, 64 GB, 2 TB', 8, 160000],
  ['Desktops', 'Mini PC for meeting rooms, Intel Core i5, 16 GB RAM, 256 GB SSD', 'Mini PC, i5, 16 GB, 256 GB', 15, 38000],
  ['Monitors', 'Monitor 24 inch, Full HD IPS, height adjustable, HDMI and DisplayPort', '24 in FHD IPS', 250, 11500],
  ['Monitors', 'Monitor 27 inch, QHD IPS, height adjustable, USB hub', '27 in QHD IPS', 80, 24000],
  ['Monitors', 'Monitor 34 inch ultrawide, WQHD, curved', '34 in ultrawide WQHD', 12, 42000],
  ['Monitors', 'Monitor 27 inch, 4K, USB-C with 90 W power delivery', '27 in 4K USB-C', 20, 36000],
  ['Docks', 'USB-C docking station, 100 W power delivery, dual display', 'USB-C dock, 100 W', 200, 9500],
  ['Docks', 'Thunderbolt 4 docking station, 96 W, triple display', 'Thunderbolt 4 dock', 60, 19500],
  ['Peripherals', 'Wireless optical mouse, 2.4 GHz', 'Wireless mouse', 400, 650],
  ['Peripherals', 'Wired USB keyboard, full size', 'Wired keyboard', 400, 700],
  ['Peripherals', 'Wireless keyboard and mouse combo', 'Wireless combo', 80, 1900],
  ['Peripherals', 'USB stereo headset with noise-cancelling microphone', 'USB headset', 250, 2800],
  ['Peripherals', 'Webcam 1080p with privacy shutter', 'Webcam 1080p', 100, 3900],
  ['Peripherals', 'Laptop backpack, 15.6 inch, padded', 'Backpack 15.6 in', 300, 1400],
  ['Peripherals', 'USB-C to HDMI adapter, 4K 60 Hz', 'USB-C to HDMI', 120, 900],
  ['Peripherals', 'Laptop cable lock, keyed', 'Cable lock', 150, 1300],
  ['Network', 'Managed switch, 48 port PoE+, 4 x 10G SFP+ uplinks', '48-port PoE+ switch', 6, 145000],
  ['Network', 'Managed switch, 24 port gigabit, 4 x SFP uplinks', '24-port switch', 6, 62000],
  ['Network', 'Wi-Fi 6E access point, tri-band, ceiling mount, PoE', 'Wi-Fi 6E access point', 30, 21000],
  ['Network', 'Next-generation firewall appliance, 2 Gbps threat protection, 3-year subscription', 'Firewall, 2 Gbps', 2, 310000],
  ['Network', '10G SFP+ short-range transceiver module', '10G SFP+ SR module', 24, 4200],
  ['Network', 'Cat6A patch cord, 3 metre, LSZH', 'Cat6A cord 3 m', 800, 240],
  ['Power', 'UPS 1 kVA line-interactive, tower', 'UPS 1 kVA', 20, 9800],
  ['Power', 'UPS 3 kVA online double-conversion, rack mount', 'UPS 3 kVA online', 4, 78000],
  ['Power', 'UPS 6 kVA online double-conversion, rack mount, with battery pack', 'UPS 6 kVA online', 1, 195000],
  ['Power', 'Rack PDU, 16 A, 12 outlets, metered', 'Rack PDU 16 A', 6, 14500],
];

// Scale the non-laptop quantities so the last-PO spend lands near Rs 4 crore.
const TARGET = 4.05e7;
const fixedCost = RAW.filter((r) => r[5]).reduce((s, r) => s + r[3] * r[4], 0);
const otherCost = RAW.filter((r) => !r[5]).reduce((s, r) => s + r[3] * r[4], 0);
const SCALE = (TARGET - fixedCost) / otherCost;

const lines = RAW.map(([category, description, spec, qty, lastPo, fixed], i) => ({
  id: `L${String(i + 1).padStart(2, '0')}`,
  category,
  description,
  spec,
  quantity: fixed ? qty : Math.max(1, Math.round(qty * SCALE)),
  lastPo,
}));
const byId = Object.fromEntries(lines.map((l) => [l.id, l]));

const questionnaire = [
  { id: 'Q1', gate: true, text: 'Are you an OEM-authorised reseller for every brand you are quoting? Attach or cite the authorisation letter.' },
  { id: 'Q2', gate: true, text: 'Do you provide on-site, next-business-day warranty service in Bengaluru for laptops and desktops?' },
  { id: 'Q3', gate: true, text: 'Do you offer e-waste take-back of the replaced equipment under the E-Waste (Management) Rules, with a certificate?' },
  { id: 'Q4', gate: false, text: 'Will you image the laptops with our build and asset-tag them before delivery?' },
  { id: 'Q5', gate: false, text: 'Do you accept payment 45 days from delivery?' },
  { id: 'Q6', gate: false, text: 'How long are the quoted prices valid?' },
  { id: 'Q7', gate: false, text: 'What is your dead-on-arrival replacement policy?' },
  { id: 'Q8', gate: false, text: 'How many seats have you delivered in a single order in the last 12 months?' },
];

export const rfx = {
  id: 'RFQ-2026-IT-031',
  title: 'Office refresh: laptops, desktops, monitors, network and power, Bengaluru',
  buyer: 'Lumen Analytics Pvt Ltd',
  scope: 'One-time supply of end-user computing, network and power equipment for our new 450-seat office at Outer Ring Road, Bengaluru. Delivered and unboxed on site. Quote the exact specification on each line.',
  currency: 'INR',
  period: 'once',
  quantityLabel: 'Quantity',
  refLabel: 'last PO',
  attributes: [
    { key: 'lead_time_days', label: 'Lead time', unit: 'days', better: 'lower' },
    { key: 'warranty_years', label: 'Warranty', unit: 'years', better: 'higher' },
  ],
  lineItems: lines.map((l) => ({ id: l.id, description: l.description, spec: l.spec, category: l.category, measures: {}, quantity: l.quantity, unit: 'unit', refPrice: l.lastPo })),
  questionnaire,
  terms: {
    priceBasis: 'Per unit, in INR, delivered to site (freight included), GST shown separately',
    delivery: 'Within 30 days of purchase order, single drop, Outer Ring Road, Bengaluru',
    warranty: 'State the warranty included in the price. Price a 3-year on-site option separately if it is not included.',
    payment: '45 days from delivery',
    responseDue: '2026-10-24',
  },
};

// ---- What each vendor really quoted ----
function spread(seed, factor, noise) {
  const rnd = mulberry32(seed);
  return lines.map((l) => l.lastPo * factor * (1 + (rnd() * 2 - 1) * noise));
}
const roundTo = (n, step) => Math.round(n / step) * step;
const nice = (n) => (n >= 20000 ? roundTo(n, 50) : n >= 2000 ? roundTo(n, 10) : roundTo(n, 5));
const COMPUTE = new Set(['Laptops', 'Desktops']);

// A: Excel, several sheets, three price breaks by quantity. Exact models, everything quoted.
const aBase = spread(101, 1.0, 0.03);
const A_LEAD = { Laptops: 18, Desktops: 21, Monitors: 14, Docks: 14, Peripherals: 7, Network: 35, Power: 28 };
const vendorA = lines.map((l, i) => {
  const t2 = nice(aBase[i]);
  const t1 = nice(t2 * 1.04);
  const t3 = nice(t2 * 0.955);
  const tiers = [
    { min: 1, price: t1 },
    { min: 100, price: t2 },
    { min: 500, price: t3 },
  ];
  const unitInr = l.quantity >= 500 ? t3 : l.quantity >= 100 ? t2 : t1;
  return { lineId: l.id, tiers, unitInr, leadDays: A_LEAD[l.category], warrantyYears: COMPUTE.has(l.category) || l.category === 'Network' ? 3 : 1 };
});

// B: PDF. Base price carries a 1-year warranty. The 3-year on-site warranty is a separate add-on per unit.
const bBase = spread(202, 0.975, 0.03);
const B_ADDON_RATE = { Laptops: 0.07, Desktops: 0.06, Monitors: 0.05, Docks: 0.05, Network: 0.08, Power: 0.06 };
const vendorB = lines.map((l, i) => {
  const base = nice(bBase[i]);
  const rate = B_ADDON_RATE[l.category];
  return { lineId: l.id, rawPrice: base, unitInr: base, addon3y: rate ? nice(base * rate) : null };
});

// C: Word, USD. Offers "equivalent" models on 6 lines, with less memory or an older chip. Those are the cheapest prices in the event.
const cBase = spread(303, 0.955, 0.025);
const C_SUBS = {
  L01: 'Orbis AeroBook 14, Intel Core Ultra 5, 8 GB RAM, 512 GB SSD (equivalent model, 8 GB in place of 16 GB)',
  L02: 'Orbis AeroBook 14 Pro, Intel Core i7 13th generation, 32 GB RAM, 1 TB SSD (equivalent, previous generation processor)',
  L04: 'Orbis Cube SFF, Intel Core i5, 8 GB RAM, 512 GB SSD (equivalent, 8 GB in place of 16 GB)',
  L07: 'Orbis View 22, 21.5 inch Full HD, tilt only (equivalent, 21.5 inch in place of 24 inch)',
  L11: 'Orbis Link dock, 65 W power delivery, dual display (equivalent, 65 W in place of 100 W)',
  L23: 'Orbis Air AX access point, Wi-Fi 6 dual-band (equivalent, Wi-Fi 6 in place of Wi-Fi 6E)',
};
const vendorC = lines.map((l, i) => {
  const sub = C_SUBS[l.id];
  const usd = Math.round(((cBase[i] * (sub ? 0.84 : 1)) / FX_USD_INR) * 100) / 100;
  return { lineId: l.id, rawPrice: usd, rawCurrency: 'USD', unitInr: r2(usd * FX_USD_INR), substitute: sub ?? null };
});

// D: photo of a printed price list. 22 of 30 lines. Mice and keyboards are priced per pack of 10.
const dBase = spread(404, 0.965, 0.03);
const D_SKIPPED = new Set(['L03', 'L05', 'L09', 'L21', 'L24', 'L25', 'L28', 'L29']);
const D_PACK10 = new Set(['L13', 'L14']);
const vendorD = lines
  .map((l, i) => {
    if (D_SKIPPED.has(l.id)) return null;
    if (D_PACK10.has(l.id)) {
      const raw = roundTo(dBase[i] * 10, 50);
      return { lineId: l.id, rawPrice: raw, pack: 10, unitInr: r2(raw / 10) };
    }
    const raw = nice(dBase[i]);
    return { lineId: l.id, rawPrice: raw, unitInr: raw };
  })
  .filter(Boolean);

// E: short email. 10% off last PO rates for laptops, the rest on a list pasted under the email.
const eBase = spread(505, 1.005, 0.03);
const E_OFF_PCT = 10;
const vendorE = lines.map((l, i) => {
  if (l.category === 'Laptops') return { lineId: l.id, fromLastPo: true, unitInr: r2(l.lastPo * (1 - E_OFF_PCT / 100)) };
  const raw = nice(eBase[i]);
  return { lineId: l.id, rawPrice: raw, unitInr: raw };
});

export const vendors = {
  A: {
    id: 'A',
    name: 'Vertex Infosystems Pvt Ltd',
    file: 'vendor-a-vertex-commercial-bid.xlsx',
    format: 'Excel',
    hard: 'A workbook with a sheet per category. Every item has three prices, and which one applies depends on how many you buy.',
    quotes: vendorA,
    terms: { freight: 'included', gst: 'extra', discountPct: 0, validity: '45 days' },
    answers: {
      Q1: { meets: 'yes', text: 'Yes. We are an authorised Platinum partner for all brands quoted. Authorisation letters dated September 2026 are enclosed.' },
      Q2: { meets: 'yes', text: 'Yes, on-site next-business-day service in Bengaluru through our own service centre at Koramangala.' },
      Q3: { meets: 'yes', text: 'Yes. E-waste take-back through our CPCB-registered recycler, with a certificate of recycling for every lot.' },
      Q4: { meets: 'na', text: 'Yes, imaging and asset tagging included at no charge for laptops and desktops.' },
      Q5: { meets: 'na', text: 'Accepted, 45 days from delivery.' },
      Q6: { meets: 'na', text: '45 days from the bid date.' },
      Q7: { meets: 'na', text: 'Replacement within 7 working days for any unit found dead on arrival within 15 days of delivery.' },
      Q8: { meets: 'na', text: '1,200 seats for a bank in Chennai.' },
    },
  },
  B: {
    id: 'B',
    name: 'Dataline Systems and Services',
    file: 'vendor-b-dataline-quotation.pdf',
    format: 'PDF',
    hard: 'Two price columns per item. One is the price, the other is an optional extra, and they must not be added together by default.',
    quotes: vendorB,
    leadDaysAll: 28,
    terms: { freight: 'included', gst: 'extra', discountPct: 0, validity: '30 days' },
    answers: {
      Q1: { meets: 'yes', text: 'Yes. Dataline is an OEM-authorised reseller for every brand in this quotation. Letters of authorisation are attached as Annexure B.' },
      Q2: { meets: 'yes', text: 'Yes. Next-business-day on-site response in Bengaluru for laptops and desktops.' },
      Q3: { meets: 'yes', text: 'Yes. We will take back the replaced equipment and issue an e-waste recycling certificate.' },
      Q4: { meets: 'na', text: 'Imaging is offered at Rs 350 per device. Asset tagging is free.' },
      Q5: { meets: 'na', text: 'We request 30 days. 45 days can be agreed for this order size.' },
      Q6: { meets: 'na', text: '30 days.' },
      Q7: { meets: 'na', text: 'Dead-on-arrival units are replaced in 5 working days if reported within 10 days.' },
      Q8: { meets: 'na', text: '800 seats.' },
    },
  },
  C: {
    id: 'C',
    name: 'Orbis Technologies FZ-LLC',
    file: 'vendor-c-orbis-proposal.docx',
    format: 'Word',
    hard: 'Prices are inside paragraphs and not in rupees. Read what is being offered on each line, not just the price.',
    quotes: vendorC,
    leadDaysAll: 45,
    warrantyYearsAll: 1,
    terms: { freight: 'included', gst: 'extra', discountPct: 0, validity: '21 days' },
    answers: {
      Q1: { meets: 'yes', text: 'we are an authorised distributor for the Orbis range and hold reseller authorisation letters for the third-party network and power brands quoted' },
      Q2: { meets: 'yes', text: 'on-site next-business-day warranty service is provided in Bengaluru through our service partner' },
      Q3: { meets: 'yes', text: 'we take back replaced equipment for recycling and provide the e-waste certificate' },
      Q4: { meets: 'na', text: 'imaging and asset tagging can be done at our Dubai hub before dispatch' },
      Q5: { meets: 'na', text: '45 days from delivery is acceptable against a bank guarantee' },
      Q6: { meets: 'na', text: '21 days, as the prices follow the dollar' },
      Q7: { meets: 'na', text: 'dead-on-arrival units are replaced from the next shipment' },
      Q8: { meets: 'na', text: 'around 2,000 seats for a customer in the Gulf' },
    },
  },
  D: {
    id: 'D',
    name: 'Sri Venkateshwara Computers',
    file: 'vendor-d-svc-price-list.jpg',
    format: 'Photo',
    hard: 'A phone photo of a printed price list. Some lines are missing, and two items are priced by the pack.',
    quotes: vendorD,
    leadDaysAll: 5,
    terms: { freight: 'extra', gst: 'extra', discountPct: 0, validity: 'not stated' },
    answers: null,
  },
  E: {
    id: 'E',
    name: 'Nexa IT Solutions',
    file: 'vendor-e-nexa-email.txt',
    format: 'Email',
    hard: 'A short email. The laptop prices are not written, they point at your last purchase order.',
    quotes: vendorE,
    leadDaysAll: 21,
    terms: { freight: 'included', gst: 'extra', discountPct: 0, validity: 'not stated' },
    answers: {
      Q1: { meets: 'yes', text: 'We are authorised partner for all brands, letters attached.' },
      Q2: { meets: 'yes', text: 'NBD onsite in Bengaluru, yes.' },
      Q3: { meets: 'no', text: 'We do not do e-waste take-back, you will need a separate recycler.' },
    },
  },
};

// What the grid should show per line with default decisions.
export const expected = (v) => Object.fromEntries(v.quotes.map((q) => [q.lineId, q.unitInr]));

const attr = (key, n, text) => ({ key, value_number: n, value_text: text ?? String(n), quote: 'selftest' });

export function perfectExtraction(v) {
  const items = v.quotes
    .filter((q) => !q.fromLastPo)
    .map((q) => {
      if (v.id === 'A') {
        return perfectItem({
          lineId: q.lineId,
          price: q.tiers[0].price,
          tiers: q.tiers.map((t) => ({ min_quantity: t.min, price_value: t.price, price_text: String(t.price) })),
          attributes: [attr('lead_time_days', q.leadDays), attr('warranty_years', q.warrantyYears)],
        });
      }
      if (v.id === 'B') {
        return perfectItem({
          lineId: q.lineId,
          price: q.rawPrice,
          addons: q.addon3y ? [{ key: 'warranty_3y', label: '3-year on-site warranty', price_value: q.addon3y, price_text: String(q.addon3y), quote: 'selftest' }] : [],
          attributes: [attr('warranty_years', 1)],
        });
      }
      if (v.id === 'C') return perfectItem({ lineId: q.lineId, price: q.rawPrice, currency: 'USD', match: q.substitute ? 'substitute' : 'exact', offered: q.substitute ?? '' });
      if (v.id === 'D') return perfectItem({ lineId: q.lineId, price: q.rawPrice, basis: q.pack ? 'per_n_units' : 'per_unit', pack: q.pack ?? null, unitText: q.pack ? 'per pack of 10' : 'each' });
      return perfectItem({ lineId: q.lineId, price: q.rawPrice });
    });
  const lastPoIds = v.quotes.filter((q) => q.fromLastPo).map((q) => q.lineId);
  const wide = [];
  if (v.leadDaysAll) wide.push(attr('lead_time_days', v.leadDaysAll));
  if (v.warrantyYearsAll) wide.push(attr('warranty_years', v.warrantyYearsAll));
  return {
    vendor_name: v.name,
    items,
    references: lastPoIds.length
      ? [{ kind: 'previous_price', scope: 'listed_lines', line_ids: lastPoIds, excluded_line_ids: [], adjustment_percent: -E_OFF_PCT, quote: '10% off our last PO rates for laptops', note: null }]
      : [],
    vendor_attributes: wide,
    answers: perfectAnswers(rfx, v.answers),
    terms: perfectTerms(v.terms),
    document_notes: [],
  };
}

export function checks(grid, h) {
  const out = [];
  const amber = grid.vendors.reduce((n, v) => n + v.counts.look, 0);
  out.push(`rules to accept: ${grid.rules.filter((r) => !r.accepted).length} (expected 4), amber cells: ${amber} (expected 6, the substitutes)`);
  const gated = { eligible_vendors: 'passed_quality_gate' };
  const any = h.awardScenario(grid, gated);
  const exact = h.awardScenario(grid, { ...gated, exact_match_only: true });
  const moved = exact.awards.filter((a) => any.awards.find((b) => b.line === a.line)?.vendor_id !== a.vendor_id).map((a) => a.line);
  out.push(`Cheapest per line, gate-cleared (${any.eligible_vendors.join(', ')}): ${any.total_cost}`);
  out.push(`Same, exact-match only: ${exact.total_cost}. Lines that changed vendor: ${moved.join(', ') || 'NONE'}  ${exact.total_cost > any.total_cost && moved.length ? 'AWARD CHANGES' : 'NO CHANGE (dataset is broken)'}`);
  // Independent hand calculation from the answer key.
  const ok = Object.values(vendors).filter((v) => v.answers && !Object.values(v.answers).some((a) => a.meets === 'no'));
  let hand = 0;
  for (const l of lines) {
    const ps = ok.map((v) => v.quotes.find((q) => q.lineId === l.id)).filter((q) => q && !q.substitute).map((q) => q.unitInr);
    hand += Math.round(Math.min(...ps) * l.quantity * 100) / 100;
  }
  out.push(`  hand calculation, exact-match only (${ok.map((v) => v.id).join('+')}): ${hand.toFixed(2)}  vs app ${exact.total_cost.toFixed(2)}  ${Math.abs(hand - exact.total_cost) < 1 ? 'MATCH' : 'DIFFERENT'}`);
  const fast = h.awardScenario(grid, { eligible_vendors: 'all', require: [{ attribute: 'lead_time_days', op: 'max', value: 21 }] });
  out.push(`All vendors, lead time at most 21 days: ${fast.total_cost} over ${fast.lines_awarded} lines, ${fast.lines_without_an_eligible_price.length} lines with no price, vendors: ${fast.vendors_in_award.map((x) => `${x.vendor} ${x.lines}`).join(' | ')}`);
  const q400 = h.awardScenario(grid, { ...gated, exact_match_only: true }).awards.find((a) => a.line === 'L01');
  const q600 = h.awardScenario(grid, { ...gated, exact_match_only: true, quantity_overrides: [{ line_ids: ['L01'], quantity: 600 }] });
  const a600 = q600.awards.find((a) => a.line === 'L01');
  const keyA = vendors.A.quotes[0].tiers;
  out.push(`L01 at 400: ${q400.vendor} ${q400.unit_price}. At 600 (what-if ${q600.what_if}): ${a600.vendor} ${a600.unit_price}. Answer key, A's breaks: ${keyA.map((t) => `${t.min}+ ${t.price}`).join(', ')}; B ${vendors.B.quotes[0].unitInr}`);
  const w = h.awardScenario(grid, { eligible_vendors: ['B'], include_addons: ['warranty_3y'] });
  const b0 = h.awardScenario(grid, { eligible_vendors: ['B'] });
  const handAddon = vendors.B.quotes.reduce((s, q) => s + (q.addon3y ?? 0) * byId[q.lineId].quantity, 0);
  out.push(`B with the 3-year warranty add-on: ${w.total_cost} vs ${b0.total_cost} without. Difference ${r2(w.total_cost - b0.total_cost)}, hand ${handAddon}  ${Math.abs(w.total_cost - b0.total_cost - handAddon) < 1 ? 'MATCH' : 'DIFFERENT'}`);
  return out;
}

// ---------- Rendering the five reply files ----------
const modelName = (l) => l.description.split(',')[0];

async function makeA(out) {
  const v = vendors.A;
  const q = Object.fromEntries(v.quotes.map((x) => [x.lineId, x]));
  const wb = new ExcelJS.Workbook();
  const cover = wb.addWorksheet('Cover');
  cover.columns = [{ width: 28 }, { width: 90 }];
  [
    ['VERTEX INFOSYSTEMS PVT LTD', ''],
    ['Commercial bid', 'VIS/BID/2026/0914, dated 18 October 2026'],
    ['Customer', 'Lumen Analytics Pvt Ltd, Bengaluru. Your reference RFQ-2026-IT-031'],
    ['How to read the price sheets', 'Each item has three unit prices. The price that applies depends on the quantity ordered of that item: 1 to 99 units, 100 to 499 units, or 500 units and above.'],
    ['Prices', 'In Indian Rupees, per unit, delivered to your Outer Ring Road site. Freight and unloading included. GST extra.'],
    ['Validity', '45 days from the bid date'],
    ['Payment', '45 days from delivery'],
  ].forEach((r, i) => {
    cover.getRow(i + 1).values = r;
    if (i === 0) cover.getRow(1).font = { bold: true, size: 15, color: { argb: 'FF0B4F6C' } };
  });
  const sheets = [
    ['Compute', ['Laptops', 'Desktops']],
    ['Displays and Docks', ['Monitors', 'Docks']],
    ['Peripherals', ['Peripherals']],
    ['Network and Power', ['Network', 'Power']],
  ];
  let sr = 0;
  for (const [name, cats] of sheets) {
    const ws = wb.addWorksheet(name);
    ws.columns = [{ width: 5 }, { width: 14 }, { width: 62 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }];
    const head = ws.getRow(1);
    head.values = ['Sr', 'Vertex part no.', 'Item offered', 'Unit price, 1-99 (Rs)', 'Unit price, 100-499 (Rs)', 'Unit price, 500+ (Rs)', 'Delivery (days from PO)', 'Warranty'];
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.alignment = { wrapText: true, vertical: 'middle' };
    head.height = 34;
    head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4F6C' } }));
    // Their own order: dearest first within the sheet.
    const rows = lines.filter((l) => cats.includes(l.category)).sort((a, b) => b.lastPo - a.lastPo);
    rows.forEach((l, i) => {
      sr++;
      const x = q[l.id];
      const row = ws.getRow(2 + i);
      row.values = [sr, `VX-${l.category.slice(0, 2).toUpperCase()}-${1000 + Number(l.id.slice(1)) * 7}`, l.description, x.tiers[0].price, x.tiers[1].price, x.tiers[2].price, x.leadDays, x.warrantyYears === 3 ? '3 years on-site' : '1 year carry-in'];
      [4, 5, 6].forEach((c) => (row.getCell(c).numFmt = '#,##0'));
    });
  }
  const comp = wb.addWorksheet('Compliance');
  comp.columns = [{ width: 46 }, { width: 100 }];
  comp.getRow(1).values = ['Your requirement', 'Our response'];
  comp.getRow(1).font = { bold: true };
  [
    ['OEM authorisation', v.answers.Q1.text],
    ['On-site NBD warranty, Bengaluru', v.answers.Q2.text],
    ['E-waste take-back', v.answers.Q3.text],
    ['Imaging and asset tagging', v.answers.Q4.text],
    ['Payment 45 days', v.answers.Q5.text],
    ['Price validity', v.answers.Q6.text],
    ['Dead on arrival', v.answers.Q7.text],
    ['Largest single order, last 12 months', v.answers.Q8.text],
  ].forEach((r, i) => (comp.getRow(2 + i).values = r));
  await wb.xlsx.writeFile(path.join(out, v.file));
}

function htmlB() {
  const v = vendors.B;
  const rows = v.quotes
    .map((x, i) => {
      const l = byId[x.lineId];
      return `<tr><td>${i + 1}</td><td>${l.description}</td><td class="r">${l.quantity.toLocaleString('en-IN')}</td><td class="r">${money(x.rawPrice, 0)}</td><td class="r">${x.addon3y ? money(x.addon3y, 0) : 'n.a.'}</td></tr>`;
    })
    .join('');
  const qa = questionnaire.map((q, i) => `<p class="qa"><b>${i + 1}. ${q.text}</b><br>${v.answers[q.id].text}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 15mm 14mm 16mm 14mm; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #1c2430; }
  .lh { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 4px solid #134074; padding-bottom: 8px; margin-bottom: 12px; }
  .lh h1 { margin: 0; font-size: 21pt; color: #134074; letter-spacing: 1px; }
  .lh .sub { font-size: 8pt; color: #555; text-align: right; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #134074; color: #fff; text-align: left; padding: 4px 5px; font-size: 8.5pt; }
  td { border-bottom: 1px solid #cfd6e0; padding: 3px 5px; font-size: 8.5pt; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; }
  .fn { font-size: 7pt; color: #555; margin-top: 8px; line-height: 1.4; }
  .qa { margin: 7px 0; }
  h2 { font-size: 12pt; color: #134074; margin-top: 16px; }
  </style></head><body>
  <div class="lh"><div><h1>DATALINE</h1><div style="font-size:9pt;color:#555">Systems and Services</div></div>
  <div class="sub">No. 88, 2nd Main, Residency Road, Bengaluru 560025<br>GSTIN 29AABCD5678K1Z3 · sales@dataline.example</div></div>
  <p><b>Quotation DSS/Q/2610/447</b> &nbsp;·&nbsp; 19 October 2026 &nbsp;·&nbsp; Your ref: RFQ-2026-IT-031</p>
  <p>To: IT Procurement, Lumen Analytics Pvt Ltd. We are pleased to quote as below for your office refresh.</p>
  <table><thead><tr><th style="width:5%">Sr</th><th>Description</th><th class="r" style="width:8%">Qty</th><th class="r" style="width:16%">Unit price (Rs)<sup>1</sup></th><th class="r" style="width:19%">3-year on-site warranty, add-on per unit (Rs)<sup>2</sup></th></tr></thead><tbody>${rows}</tbody></table>
  <div class="fn"><sup>1</sup> Unit price in Indian Rupees, delivered to your site in Bengaluru, freight included. GST extra. The unit price carries the manufacturer's standard 1-year warranty.
  <sup>2</sup> Optional. Add this amount to the unit price if you want the warranty extended to 3 years on-site. It is not included in the unit price. "n.a." means no extended warranty is offered on that item.
  Delivery: 4 weeks from purchase order for all items. Prices valid 30 days.</div>
  <h2 style="page-break-before: always">Annexure A: replies to your supplier questionnaire</h2>
  ${qa}
  <p style="margin-top:24px">For Dataline Systems and Services<br><br><br>Authorised Signatory</p>
  </body></html>`;
}

async function makeC(out) {
  const v = vendors.C;
  const q = Object.fromEntries(v.quotes.map((x) => [x.lineId, x]));
  const usd = (n) => `USD ${n.toFixed(2)}`;
  const phrase = (l) => {
    const x = q[l.id];
    return x.substitute ? `in place of the ${modelName(l).toLowerCase()} you specified we propose the ${x.substitute}, at ${usd(x.rawPrice)} per unit` : `the ${l.description.charAt(0).toLowerCase()}${l.description.slice(1)} at ${usd(x.rawPrice)} per unit`;
  };
  const sentence = (cat, intro) => intro + lines.filter((l) => l.category === cat).map(phrase).join('; ') + '.';
  const para = (text, opts = {}) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text, ...opts })] });
  const a = v.answers;
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Orbis Technologies FZ-LLC')] }),
          para('Office 1204, Jumeirah Lake Towers, Dubai, United Arab Emirates. India liaison office: Indiranagar, Bengaluru.'),
          para('20 October 2026'),
          para('Proposal for Lumen Analytics Pvt Ltd against RFQ-2026-IT-031', { bold: true }),
          para(
            'Dear Procurement Team, thank you for the opportunity. We invoice from our Dubai entity, so all prices in this proposal are in US dollars, per unit, delivered duty paid to your Bengaluru office with freight included. GST is extra. Where we could better your budget with an equivalent model from our own Orbis range, we have said so against the item.',
          ),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Commercial offer')] }),
          para(sentence('Laptops', 'For laptops, we offer ')),
          para(sentence('Desktops', 'For desktops and meeting-room PCs, we offer ')),
          para(sentence('Monitors', 'On displays, we offer ')),
          para(sentence('Docks', 'On docking stations, we offer ')),
          para(sentence('Peripherals', 'For peripherals, we offer ')),
          para(sentence('Network', 'For the network, we offer ')),
          para(sentence('Power', 'For power protection, we offer ')),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Delivery, warranty and your questionnaire')] }),
          para('Delivery is 45 days from purchase order for every item, as the goods ship from our Dubai hub. All items carry a 1 year warranty.'),
          para(`On your questionnaire: ${a.Q1.text}; ${a.Q2.text}; and ${a.Q3.text}. Further, ${a.Q4.text}. On payment, ${a.Q5.text}. The prices are valid for ${a.Q6.text}. On faulty units, ${a.Q7.text}. Our largest single order in the last twelve months was ${a.Q8.text}.`),
          para('We look forward to working with you.'),
          para('Sincerely, Farah Qureshi, Regional Sales Director, Orbis Technologies FZ-LLC'),
        ],
      },
    ],
  });
  fs.writeFileSync(path.join(out, v.file), await Packer.toBuffer(doc));
}

function htmlD() {
  const v = vendors.D;
  const rows = v.quotes.map((x) => {
    const l = byId[x.lineId];
    return `<tr><td>${l.spec}</td><td class="r">${money(x.rawPrice, 0)}${x.pack ? ' #' : ''}</td></tr>`;
  });
  const half = Math.ceil(rows.length / 2);
  const tbl = (rs) => `<table><thead><tr><th>Item</th><th class="r">Rate (Rs)</th></tr></thead><tbody>${rs.join('')}</tbody></table>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; }
  body { background: linear-gradient(160deg, #2f3a45 0%, #1d252d 60%, #12181d 100%); perspective: 2400px; overflow: hidden; }
  .glass { position: absolute; inset: 0; background: repeating-linear-gradient(135deg, rgba(255,255,255,0.025) 0 2px, rgba(0,0,0,0.02) 2px 11px); }
  .paper { position: absolute; left: 230px; top: 60px; width: 1400px; height: 1060px; background: #f7f6f1; box-shadow: -14px 24px 46px rgba(0,0,0,0.6);
    transform: rotateX(16deg) rotateY(13deg) rotateZ(-5.5deg); transform-origin: center; padding: 44px 54px; box-sizing: border-box;
    font-family: 'Courier New', Courier, monospace; color: #1a1a1a; filter: blur(0.5px) contrast(0.94); }
  .shade { position: absolute; inset: 0; background: linear-gradient(250deg, rgba(255,255,255,0.2) 0%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.2) 100%); pointer-events: none; }
  h1 { margin: 0; font-size: 40px; letter-spacing: 2px; font-family: Arial, sans-serif; color: #0d3b66; }
  .addr { font-size: 19px; margin-top: 4px; font-family: Arial, sans-serif; color: #444; }
  .title { font-size: 24px; font-weight: bold; margin: 16px 0 10px; border-top: 2px dashed #333; border-bottom: 2px dashed #333; padding: 6px 0; display: flex; justify-content: space-between; }
  .cols { display: flex; gap: 44px; }
  table { border-collapse: collapse; width: 100%; font-size: 23px; }
  th { text-align: left; border-bottom: 2px solid #222; padding: 5px 4px; }
  td { border-bottom: 1px dotted #999; padding: 8px 4px; }
  .r { text-align: right; white-space: nowrap; }
  .notes { margin-top: 16px; font-size: 20px; line-height: 1.5; }
  </style></head><body><div class="glass"></div>
  <div class="paper">
    <h1>SRI VENKATESHWARA COMPUTERS</h1>
    <div class="addr">Shop 14, SP Road, Bengaluru 560002 &nbsp;|&nbsp; Ph. 080 4000 0000</div>
    <div class="title"><span>PRICE LIST: Lumen Analytics, RFQ-2026-IT-031</span><span>21-10-2026</span></div>
    <div class="cols"><div style="flex:1">${tbl(rows.slice(0, half))}</div><div style="flex:1">${tbl(rows.slice(half))}</div></div>
    <div class="notes"># Rate is per pack of 10 nos.<br>All rates per piece unless marked. GST extra. Delivery charges extra.<br>Ready stock, delivery in 5 days. Other items not available with us.</div>
    <div class="shade"></div>
  </div></body></html>`;
}

function makeE(out) {
  const v = vendors.E;
  const list = v.quotes
    .filter((x) => !x.fromLastPo)
    .map((x) => `${byId[x.lineId].spec} - Rs ${money(x.rawPrice, 0)}`)
    .join('\n');
  const text = `From: Rohit Nair <rohit.nair@nexait.example>
To: it-procurement@lumenanalytics.example
Date: Thu, 22 Oct 2026 21:07:44 +0530
Subject: Re: RFQ-2026-IT-031 office refresh

Hi,
10% off our last PO rates for laptops. Rest as per attached list.
Delivery 3 weeks for everything. Freight included, GST extra.
${v.answers.Q1.text} ${v.answers.Q2.text} ${v.answers.Q3.text}

Rohit
Nexa IT Solutions

--- Attached: Nexa_pricelist_Lumen.txt (rates per unit, Rs) ---
${list}
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
  await pageD.screenshot({ path: path.join(out, vendors.D.file), type: 'jpeg', quality: 74 });
  await pageD.close();
}
