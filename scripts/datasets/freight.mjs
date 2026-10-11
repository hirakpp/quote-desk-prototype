// Freight lanes dataset: an annual full-truckload road freight contract. The vendors object is
// the answer key. It is written to scripts/truth/freight.json and must never reach src/ or public/.
// Why "cheapest" is wrong here: the cheapest carrier cannot supply enough trucks.
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { mulberry32, money, perfectAnswers, perfectItem, perfectTerms, r2 } from '../lib.mjs';

export const meta = {
  id: 'freight',
  title: 'Road freight lanes',
  buyer: 'Suryodaya Appliances Ltd',
  kind: 'Annual rate contract',
  value: '₹4 crore',
  valueNote: 'a year',
  summary: '30 full-truckload lanes out of the Pune and Hosur plants, about ₹4 crore a year.',
  whyCheapestIsWrong: 'The cheapest carrier cannot supply enough trucks.',
  edges: [
    'Excel with clean per-trip rates and a trucks-a-month limit on each lane',
    'PDF priced per tonne, with a diesel clause in a footnote',
    'Word doc priced per km, one paragraph per region, tolls extra',
    'Screenshot of a WhatsApp chat, 18 of 30 lanes, vehicle size missing on some',
    'Email: "current contract rates plus 6%", and no south lanes',
  ],
  questions: [
    'Cheapest per lane among carriers who cleared the quality gate, but nobody gets more trucks than they said they can supply.',
    'Which lanes have only one bidder?',
    'What happens to that award if diesel goes up ₹5?',
    'Where is the fastest carrier more than 10% dearer than the cheapest?',
    'What does it cost to give everything to one carrier?',
    "What will tolls add on Deccan Express's lanes?",
  ],
};

// [origin, destination, region, km, load in tonnes, relative trips, current contract Rs per km (null = new lane, no rate on file)]
const RAW = [
  ['Pune', 'Mumbai', 'West', 150, 9, 96, 62],
  ['Pune', 'Surat', 'West', 420, 9, 48, 47],
  ['Pune', 'Ahmedabad', 'West', 660, 9, 60, 44],
  ['Pune', 'Goa', 'West', 450, 9, 24, 50],
  ['Pune', 'Indore', 'North', 600, 9, 36, 45],
  ['Pune', 'Nagpur', 'North', 720, 16, 48, 58],
  ['Pune', 'Jaipur', 'North', 1180, 9, 36, 42],
  ['Pune', 'Delhi NCR', 'North', 1450, 16, 72, 55],
  ['Pune', 'Lucknow', 'North', 1400, 9, 24, 42],
  ['Pune', 'Ludhiana', 'North', 1750, 9, 18, 41],
  ['Pune', 'Kolkata', 'East', 1900, 16, 30, 54],
  ['Pune', 'Hyderabad', 'South', 560, 9, 60, 45],
  ['Pune', 'Bengaluru', 'South', 840, 16, 72, 57],
  ['Pune', 'Chennai', 'South', 1180, 9, 36, 43],
  ['Pune', 'Kochi', 'South', 1300, 9, 18, 44],
  ['Hosur', 'Bengaluru', 'South', 40, 9, 120, 110],
  ['Hosur', 'Chennai', 'South', 310, 16, 96, 66],
  ['Hosur', 'Coimbatore', 'South', 280, 9, 48, 52],
  ['Hosur', 'Kochi', 'South', 480, 9, 36, 49],
  ['Hosur', 'Madurai', 'South', 390, 9, 30, 50],
  ['Hosur', 'Mangaluru', 'South', 390, 9, 18, 52],
  ['Hosur', 'Hyderabad', 'South', 600, 16, 60, 58],
  ['Hosur', 'Vijayawada', 'South', 650, 9, 30, 46],
  ['Hosur', 'Visakhapatnam', 'South', 1000, 9, 24, 44],
  ['Hosur', 'Pune', 'West', 880, 16, 48, 56],
  ['Hosur', 'Mumbai', 'West', 1020, 16, 60, 55],
  ['Hosur', 'Ahmedabad', 'West', 1540, 9, 24, 42],
  ['Hosur', 'Nagpur', 'North', 1100, 9, 24, 43],
  ['Hosur', 'Delhi NCR', 'North', 2200, 16, 36, 53],
  ['Hosur', 'Kolkata', 'East', 1900, 16, 18, null],
];

const TRIP_SCALE = 0.84; // tuned so the current-contract spend lands near Rs 4 crore
const lines = RAW.map(([origin, dest, region, km, tonne, rel, perKm], i) => ({
  id: `L${String(i + 1).padStart(2, '0')}`,
  origin,
  dest,
  region,
  km,
  tonne,
  trips: Math.max(6, Math.round((rel * TRIP_SCALE) / 6) * 6),
  // What a fair rate looks like on this lane, used to build every vendor's price.
  base: Math.round((km * (perKm ?? 54)) / 100) * 100,
  current: perKm == null ? null : Math.round((km * perKm) / 100) * 100,
}));
const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
const truck = (l) => (l.tonne === 16 ? '32 ft multi-axle, 16 tonne' : '32 ft single-axle, 9 tonne');

const questionnaire = [
  { id: 'Q1', gate: true, text: 'Is every vehicle you will place on our lanes fitted with GPS tracking that we can view live?' },
  { id: 'Q2', gate: true, text: 'Do you carry transit insurance covering our goods up to Rs 50 lakh per consignment?' },
  { id: 'Q3', gate: true, text: 'Do the vehicles hold a valid national permit for the full contract year?' },
  { id: 'Q4', gate: false, text: 'How many vehicles do you own, and how many do you take from the market?' },
  { id: 'Q5', gate: false, text: 'Do you accept payment 45 days from proof of delivery?' },
  { id: 'Q6', gate: false, text: 'What do you charge for detention beyond 24 hours at loading or unloading?' },
  { id: 'Q7', gate: false, text: 'How many days after delivery do you return the signed proof of delivery?' },
  { id: 'Q8', gate: false, text: 'What was your damage claim ratio over the last 12 months, in percent of consignments?' },
];

export const rfx = {
  id: 'RFQ-2026-FRT-007',
  title: 'Annual road freight contract: full truckload lanes from Pune and Hosur, FY 2026-27',
  buyer: 'Suryodaya Appliances Ltd',
  scope: 'Full-truckload movement of packed home appliances from our Chakan (Pune) and Hosur plants to regional warehouses for 12 months. Trips are annual estimates, placed weekly. Quote an all-in rate per trip for the vehicle named on each lane.',
  currency: 'INR',
  period: 'year',
  quantityLabel: 'Trips a year',
  refLabel: 'current contract',
  // What the freight field of the reading records for this event.
  extrasLabel: 'Tolls and extras',
  attributes: [
    { key: 'transit_days', label: 'Transit time', unit: 'days', better: 'lower' },
    { key: 'trucks_per_month', label: 'Trucks a month', unit: 'trucks a month', better: 'higher', capacity: { periodsPerYear: 12 } },
  ],
  lineItems: lines.map((l) => ({
    id: l.id,
    description: `${l.origin} to ${l.dest}, ${l.km} km, ${truck(l)}`,
    spec: `${l.origin} to ${l.dest}`,
    category: `${l.region} lanes`,
    measures: { km: l.km, tonne: l.tonne },
    quantity: l.trips,
    unit: 'trip',
    refPrice: l.current,
  })),
  questionnaire,
  terms: {
    priceBasis: 'Per trip, in INR, all-in: tolls, loading supervision and 24 hours of free detention included. GST shown separately',
    vehicle: 'As named on each lane. Closed body, not older than 6 years',
    payment: '45 days from proof of delivery',
    fuel: 'State any diesel escalation clause, with the base price and the rate of change',
    responseDue: '2026-10-22',
  },
};

// ---- What each carrier really quoted ----
function spread(seed, factor, noise) {
  const rnd = mulberry32(seed);
  return lines.map((l) => l.base * factor * (1 + (rnd() * 2 - 1) * noise));
}
const r100 = (n) => Math.round(n / 100) * 100;

// A: Excel. Clean per-trip rates, the cheapest carrier, but a trucks-a-month limit on every lane.
// Not on the two Kolkata lanes.
const aBase = spread(71, 0.9, 0.025);
const A_SKIPPED = new Set(['L11', 'L30']);
const vendorA = lines
  .map((l, i) => {
    if (A_SKIPPED.has(l.id)) return null;
    const perMonth = Math.max(1, Math.floor((l.trips / 12) * (l.trips >= 24 ? 0.55 : 1.2)));
    return { lineId: l.id, rawPrice: r100(aBase[i]), unitInr: r100(aBase[i]), trucksPerMonth: perMonth, transitDays: Math.ceil(l.km / 330) + 1 };
  })
  .filter(Boolean);

// B: PDF. Rates per tonne. A footnote ties the rate to diesel. Faster, dearer, all 30 lanes.
const bBase = spread(82, 0.985, 0.03);
const B_DIESEL_BASE = 92;
const B_DIESEL_PCT = 0.45;
const vendorB = lines.map((l, i) => {
  const perTonne = Math.round(bBase[i] / l.tonne / 10) * 10;
  return { lineId: l.id, rawPrice: perTonne, unitInr: r2(perTonne * l.tonne), transitDays: Math.ceil(l.km / 480) + 1 };
});

// C: Word. One rate per km for each region, in a paragraph. Tolls extra. No east lanes.
const C_PER_KM = { West: { 9: 46, 16: 54 }, North: { 9: 40.5, 16: 52 }, South: { 9: 47.5, 16: 56 } };
const C_TRANSIT = { West: 3, North: 5, South: 3 };
const vendorC = lines
  .map((l) => {
    const rate = C_PER_KM[l.region]?.[l.tonne];
    if (!rate) return null;
    return { lineId: l.id, rawPrice: rate, unitInr: r2(rate * l.km), transitDays: C_TRANSIT[l.region] };
  })
  .filter(Boolean);

// D: WhatsApp screenshot. A regional carrier out of Pune and a few Hosur lanes. 18 of 30.
// The vehicle size is not written for some lanes.
const dBase = spread(93, 0.93, 0.03);
const D_LANES = ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L12', 'L13', 'L14', 'L16', 'L17', 'L18', 'L22', 'L25', 'L26'];
const D_NO_VEHICLE = new Set(['L06', 'L08', 'L13', 'L26']);
const vendorD = D_LANES.map((id) => {
  const i = lines.findIndex((l) => l.id === id);
  return { lineId: id, rawPrice: r100(dBase[i]), unitInr: r100(dBase[i]), vehicleNotStated: D_NO_VEHICLE.has(id) };
});

// E: the incumbent, by email. Current contract rates plus 6% on all lanes, and no south lanes.
// The one new lane has no current rate on file, so it cannot be filled.
const E_PLUS_PCT = 6;
const E_EXCLUDED = lines.filter((l) => l.region === 'South').map((l) => l.id);
const vendorE = lines.filter((l) => l.region !== 'South' && l.current != null).map((l) => ({ lineId: l.id, fromCurrent: true, unitInr: r2(l.current * (1 + E_PLUS_PCT / 100)) }));

export const vendors = {
  A: {
    id: 'A',
    name: 'TransIndia Roadlines Pvt Ltd',
    file: 'vendor-a-transindia-lane-rates.xlsx',
    format: 'Excel',
    hard: 'Clean rates, but read the other columns too. One of them limits how much of the work this carrier can take.',
    quotes: vendorA,
    terms: { freight: 'included', gst: 'extra', discountPct: 0, validity: '12 months' },
    answers: {
      Q1: { meets: 'yes', text: 'Yes. All vehicles have GPS and we will share a live tracking login.' },
      Q2: { meets: 'yes', text: 'Yes. Open transit policy, cover of Rs 75 lakh per consignment.' },
      Q3: { meets: 'yes', text: 'Yes. National permits valid, renewed every March.' },
      Q4: { meets: 'na', text: '62 owned vehicles. We do not use market vehicles on contract lanes.' },
      Q5: { meets: 'na', text: 'Agreed, 45 days from POD.' },
      Q6: { meets: 'na', text: 'Rs 1,500 per day after 24 hours.' },
      Q7: { meets: 'na', text: '7 days.' },
      Q8: { meets: 'na', text: '0.3%' },
    },
  },
  B: {
    id: 'B',
    name: 'Bharat Cargo Movers Ltd',
    file: 'vendor-b-bharat-cargo-offer.pdf',
    format: 'PDF',
    hard: 'The rate column is not per trip. And a footnote lets the rate move with the price of diesel.',
    quotes: vendorB,
    terms: { freight: 'included', gst: 'extra', discountPct: 0, validity: '12 months', indexName: 'diesel', indexPercentPerUnit: B_DIESEL_PCT },
    answers: {
      Q1: { meets: 'yes', text: 'Yes. Every vehicle is GPS enabled and visible on our customer portal in real time.' },
      Q2: { meets: 'yes', text: 'Yes. Transit insurance of Rs 1 crore per consignment is in force.' },
      Q3: { meets: 'yes', text: 'Yes. All vehicles carry a valid national permit.' },
      Q4: { meets: 'na', text: '410 owned vehicles and about 150 attached market vehicles.' },
      Q5: { meets: 'na', text: 'We request 30 days. 45 days is acceptable for this volume.' },
      Q6: { meets: 'na', text: 'Rs 2,000 per day for 9 tonne and Rs 2,800 per day for 16 tonne vehicles after 24 hours.' },
      Q7: { meets: 'na', text: 'Scanned POD in 48 hours, hard copy in 10 days.' },
      Q8: { meets: 'na', text: '0.2%' },
    },
  },
  C: {
    id: 'C',
    name: 'Deccan Express Logistics',
    file: 'vendor-c-deccan-express-proposal.docx',
    format: 'Word',
    hard: 'No table. Each region gets one rate in a sentence, and it is not a rate per trip. One cost is left outside the rate.',
    quotes: vendorC,
    terms: { freight: 'extra', gst: 'extra', discountPct: 0, validity: '6 months' },
    answers: {
      Q1: { meets: 'yes', text: 'all our vehicles are fitted with GPS and you will have live access' },
      Q2: { meets: 'yes', text: 'we hold transit insurance of Rs 50 lakh per consignment' },
      Q3: { meets: 'yes', text: 'the vehicles have national permits valid through the contract year' },
      Q4: { meets: 'na', text: '85 vehicles of our own and a panel of market vehicles for peaks' },
      Q5: { meets: 'na', text: '45 days from proof of delivery is fine' },
      Q6: { meets: 'na', text: 'Rs 1,800 per day after the first 24 hours' },
      Q7: { meets: 'na', text: 'within 10 days of delivery' },
      Q8: { meets: 'na', text: 'under 0.5%' },
    },
  },
  D: {
    id: 'D',
    name: 'Jai Ambe Transport',
    file: 'vendor-d-jai-ambe-whatsapp.png',
    format: 'Photo',
    hard: 'A screenshot of a chat. Rates come in several messages, some lanes are left out, and the vehicle is not always named.',
    quotes: vendorD,
    terms: { freight: 'extra', gst: 'not stated', discountPct: 0, validity: 'not stated' },
    answers: null,
  },
  E: {
    id: 'E',
    name: 'Shakti Logistics',
    file: 'vendor-e-shakti-email.txt',
    format: 'Email',
    hard: 'Two sentences from the current carrier. No rates are written, and part of the work is turned down.',
    quotes: vendorE,
    terms: { freight: 'included', gst: 'not stated', discountPct: 0, validity: 'not stated' },
    answers: {
      Q1: { meets: 'yes', text: 'GPS on all vehicles as today.' },
      Q2: { meets: 'yes', text: 'Transit insurance as per current contract, Rs 50 lakh.' },
      Q3: { meets: 'yes', text: 'National permits valid till March 2028.' },
    },
  },
};

// What the grid should show per lane with default decisions.
export const expected = (v) => Object.fromEntries(v.quotes.map((q) => [q.lineId, q.unitInr]));

const attr = (key, n) => ({ key, value_number: n, value_text: String(n), quote: 'selftest' });

export function perfectExtraction(v) {
  const items = v.quotes
    .filter((q) => !q.fromCurrent)
    .map((q) => {
      if (v.id === 'A') return perfectItem({ lineId: q.lineId, price: q.rawPrice, unitText: 'per trip', attributes: [attr('transit_days', q.transitDays), attr('trucks_per_month', q.trucksPerMonth)] });
      if (v.id === 'B') return perfectItem({ lineId: q.lineId, price: q.rawPrice, unitText: 'per tonne', basis: 'per_measure', measure: 'tonne', attributes: [attr('transit_days', q.transitDays)] });
      if (v.id === 'C') return perfectItem({ lineId: q.lineId, price: q.rawPrice, unitText: 'per km', basis: 'per_measure', measure: 'km', attributes: [attr('transit_days', q.transitDays)] });
      const item = perfectItem({ lineId: q.lineId, price: q.rawPrice, unitText: 'per trip' });
      if (q.vehicleNotStated) item.note = 'The message does not say which vehicle size this rate is for.';
      return item;
    });
  const hasRef = v.quotes.some((q) => q.fromCurrent);
  return {
    vendor_name: v.name,
    items,
    references: hasRef
      ? [{ kind: 'previous_price', scope: 'all_lines_not_otherwise_quoted', line_ids: [], excluded_line_ids: E_EXCLUDED, adjustment_percent: E_PLUS_PCT, quote: 'Current contract rates plus 6% on all lanes', note: null }]
      : [],
    vendor_attributes: [],
    answers: perfectAnswers(rfx, v.answers),
    terms: perfectTerms(v.terms),
    document_notes: v.id === 'D' ? ['Rates were sent as chat messages. Some lanes do not name the vehicle size.'] : [],
  };
}

export function checks(grid, h) {
  const out = [];
  const amber = grid.vendors.reduce((n, v) => n + v.counts.look + v.counts.noPrice, 0);
  out.push(`rules to accept: ${grid.rules.filter((r) => !r.accepted).length} (expected 3), amber cells: ${amber} (expected 6: 4 lanes with no vehicle named, 1 lane with no current rate to fill from, 1 per-km rate on a 40 km lane that lands far under the current rate)`);
  const gated = { eligible_vendors: 'passed_quality_gate' };
  const free = h.awardScenario(grid, gated);
  const capped = h.awardScenario(grid, { ...gated, respect_capacity: true });
  const share = (r, name) => r.vendors_in_award.find((x) => x.vendor.startsWith(name))?.share_pct ?? 0;
  out.push(`Cheapest per lane, gate-cleared (${free.eligible_vendors.join(', ')}): ${free.total_cost}. TransIndia share ${share(free, 'TransIndia')}%`);
  out.push(`Same, within stated truck limits: ${capped.total_cost}. TransIndia share ${share(capped, 'TransIndia')}%  ${capped.total_cost > free.total_cost ? 'AWARD CHANGES' : 'NO CHANGE (dataset is broken)'}`);
  // Independent hand calculation from the answer key: fill each lane cheapest first up to A's limit.
  const ok = Object.values(vendors).filter((v) => v.answers && !Object.values(v.answers).some((a) => a.meets === 'no'));
  let hand = 0;
  for (const l of lines) {
    const opts = ok
      .map((v) => ({ q: v.quotes.find((x) => x.lineId === l.id) }))
      .filter((o) => o.q)
      .map((o) => ({ price: o.q.unitInr, cap: o.q.trucksPerMonth != null ? o.q.trucksPerMonth * 12 : Infinity }))
      .sort((a, b) => a.price - b.price);
    let left = l.trips;
    for (const o of opts) {
      const take = Math.min(left, o.cap);
      hand += Math.round(o.price * take * 100) / 100;
      left -= take;
      if (left <= 0) break;
    }
  }
  out.push(`  hand calculation within truck limits (${ok.map((v) => v.id).join('+')}): ${hand.toFixed(2)}  vs app ${capped.total_cost.toFixed(2)}  ${Math.abs(hand - capped.total_cost) < 1 ? 'MATCH' : 'DIFFERENT'}`);
  const diesel = h.awardScenario(grid, { ...gated, respect_capacity: true, index_changes: [{ index: 'diesel', change: 5 }] });
  out.push(`Diesel up Rs 5 (what-if ${diesel.what_if}): ${diesel.total_cost}, was ${capped.total_cost}. Bharat Cargo share ${share(capped, 'Bharat')}% -> ${share(diesel, 'Bharat')}%`);
  const one = h.aggregate(grid, { group_by: 'line', filter: { field: 'vendors_pricing', op: 'eq', value: 1 } });
  out.push(`Lanes with only one bidder: ${one.rows.map((r) => `${r.line} (${r.lowest_vendor})`).join(', ') || 'none'}`);
  const fast = h.aggregate(grid, { group_by: 'line', attribute: 'transit_days', filter: { field: 'pct_best_transit_days_dearer_than_lowest', op: 'gt', value: 10 } });
  out.push(`Lanes where the fastest carrier is more than 10% dearer than the cheapest: ${fast.rows.length} (${fast.rows.slice(0, 5).map((r) => `${r.line} +${r.pct_best_transit_days_dearer_than_lowest}%`).join(', ')}...)`);
  return out;
}

// ---------- Rendering the five reply files ----------
async function makeA(out) {
  const v = vendors.A;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Lane rates');
  ws.columns = [{ width: 6 }, { width: 14 }, { width: 18 }, { width: 10 }, { width: 22 }, { width: 16 }, { width: 14 }, { width: 18 }];
  ws.mergeCells('A1:H1');
  ws.getCell('A1').value = 'TRANSINDIA ROADLINES PVT LTD';
  ws.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FF7B2D26' } };
  ws.mergeCells('A2:H2');
  ws.getCell('A2').value = 'Transport Nagar, Nigdi, Pune 411044 | Branch: SIPCOT Phase II, Hosur | contracts@transindia.example';
  ws.mergeCells('A3:H3');
  ws.getCell('A3').value = 'Rate offer TIR/RC/26-27/118 dated 17-10-2026 against your RFQ-2026-FRT-007';
  ws.getCell('A3').font = { bold: true };
  const head = ws.getRow(5);
  head.values = ['Sr', 'From', 'To', 'Km', 'Vehicle', 'Rate per trip (Rs)', 'Transit (days)', 'Max trucks we can place per month'];
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { wrapText: true, vertical: 'middle' };
  head.height = 32;
  head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7B2D26' } }));
  // Their own order: by destination, alphabetically.
  const order = [...v.quotes].sort((a, b) => byId[a.lineId].dest.localeCompare(byId[b.lineId].dest) || byId[a.lineId].origin.localeCompare(byId[b.lineId].origin));
  order.forEach((q, i) => {
    const l = byId[q.lineId];
    const row = ws.getRow(6 + i);
    row.values = [i + 1, l.origin === 'Pune' ? 'Chakan (Pune)' : 'Hosur', l.dest, l.km, l.tonne === 16 ? '32ft MXL 16T' : '32ft SXL 9T', q.rawPrice, q.transitDays, q.trucksPerMonth];
    row.getCell(6).numFmt = '#,##0';
  });
  const t = 6 + order.length + 1;
  [
    'Terms:',
    '1. Rates are per trip, all inclusive of tolls, driver expenses and 24 hours free detention. GST extra.',
    '2. The last column is the most vehicles we can commit on that lane in a month from our own fleet. We do not place market vehicles.',
    '3. We are not quoting for Kolkata from either plant.',
    '4. Rates firm for 12 months. Payment 45 days from POD.',
  ].forEach((n, i) => {
    ws.mergeCells(`A${t + i}:H${t + i}`);
    ws.getCell(`A${t + i}`).value = n;
    if (i === 0) ws.getCell(`A${t + i}`).font = { bold: true };
  });
  const ws2 = wb.addWorksheet('Questionnaire');
  ws2.columns = [{ width: 40 }, { width: 90 }];
  ws2.getRow(1).values = ['Point', 'Our reply'];
  ws2.getRow(1).font = { bold: true };
  [
    ['GPS on vehicles', v.answers.Q1.text],
    ['Transit insurance', v.answers.Q2.text],
    ['National permit', v.answers.Q3.text],
    ['Fleet', v.answers.Q4.text],
    ['Payment 45 days', v.answers.Q5.text],
    ['Detention', v.answers.Q6.text],
    ['POD return', v.answers.Q7.text],
    ['Damage claims', v.answers.Q8.text],
  ].forEach((r, i) => (ws2.getRow(2 + i).values = r));
  await wb.xlsx.writeFile(path.join(out, v.file));
}

function htmlB() {
  const v = vendors.B;
  const rows = v.quotes
    .map((q, i) => {
      const l = byId[q.lineId];
      return `<tr><td>${i + 1}</td><td>${l.origin} to ${l.dest}</td><td class="r">${l.km}</td><td>${l.tonne === 16 ? '16 MT multi-axle' : '9 MT single-axle'}</td><td class="r">${money(q.rawPrice, 0)}</td><td class="r">${q.transitDays}</td></tr>`;
    })
    .join('');
  const qa = questionnaire.map((q, i) => `<p class="qa"><b>${i + 1}. ${q.text}</b><br>${v.answers[q.id].text}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 15mm 14mm 16mm 14mm; }
  body { font-family: 'Trebuchet MS', Verdana, sans-serif; font-size: 9.5pt; color: #20242a; }
  .lh { border-bottom: 3px solid #b3541e; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; }
  .lh h1 { margin: 0; font-size: 20pt; color: #b3541e; }
  .lh .sub { font-size: 8pt; color: #555; text-align: right; line-height: 1.45; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #f6e7dc; text-align: left; border: 1px solid #d9b99f; padding: 4px 6px; font-size: 8.8pt; }
  td { border: 1px solid #e3cdbb; padding: 3px 6px; font-size: 8.8pt; }
  .r { text-align: right; }
  .fn { font-size: 6.8pt; color: #666; margin-top: 9px; line-height: 1.4; }
  .qa { margin: 7px 0; }
  h2 { font-size: 12pt; color: #b3541e; margin-top: 16px; }
  </style></head><body>
  <div class="lh"><div><h1>BHARAT CARGO MOVERS LTD</h1><div style="font-size:9pt;color:#555">Full truckload and part load, pan India, since 1987</div></div>
  <div class="sub">Plot 9, Transport Hub, Bhiwandi 421302<br>GSTIN 27AAACB9087M1ZQ · rfq@bharatcargo.example</div></div>
  <p><b>Offer BCM/CORP/2026/2291</b> &nbsp;·&nbsp; 18 October 2026</p>
  <p>To: Head of Logistics, Suryodaya Appliances Ltd<br>Subject: Rates against RFQ-2026-FRT-007, annual full truckload contract</p>
  <p>Dear Sir, we are pleased to submit our freight rates for your lanes out of Chakan and Hosur.</p>
  <table><thead><tr><th style="width:6%">Sr</th><th>Lane</th><th class="r" style="width:9%">Km</th><th style="width:21%">Vehicle</th><th class="r" style="width:20%">Freight rate (Rs per MT)<sup>1</sup></th><th class="r" style="width:13%">Transit (days)</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="fn"><sup>1</sup> Freight is charged per metric tonne on the full rated load of the vehicle named (9 MT or 16 MT), whatever the actual weight loaded. Rates include tolls and 24 hours of free detention. GST extra.
  Rates are based on a diesel price of Rs ${B_DIESEL_BASE} per litre at Mumbai. For every Rs 1 per litre increase in the diesel price, the freight rates above will increase by ${B_DIESEL_PCT}%, reviewed on the first of each month. We have no limit on the number of vehicles we can place. Rates valid for 12 months subject to this clause.</div>
  <h2 style="page-break-before: always">Annexure: supplier questionnaire</h2>
  ${qa}
  <p style="margin-top:24px">For Bharat Cargo Movers Ltd<br><br><br>Vice President, Corporate Accounts</p>
  </body></html>`;
}

async function makeC(out) {
  const v = vendors.C;
  const para = (text, opts = {}) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text, ...opts })] });
  const a = v.answers;
  const region = (name, towns) =>
    `For the ${name.toLowerCase()} lanes (${towns}) our rate is Rs ${C_PER_KM[name][9]} per km for the 9 tonne single-axle vehicle and Rs ${C_PER_KM[name][16]} per km for the 16 tonne multi-axle vehicle, charged on the one-way distance in your RFQ. Transit on these lanes is ${C_TRANSIT[name]} days.`;
  const towns = (r) => [...new Set(lines.filter((l) => l.region === r).map((l) => l.dest))].join(', ');
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Deccan Express Logistics')] }),
          para('3rd Floor, Lakshmi Towers, Hosur Road, Bengaluru 560068'),
          para('19 October 2026'),
          para('Proposal for Suryodaya Appliances Ltd, RFQ-2026-FRT-007', { bold: true }),
          para(
            'Dear Team, thank you for including us. We price all full-truckload work on a per kilometre basis so that you pay the same way on every lane. The rates below are in Indian Rupees per kilometre and cover the vehicle, the driver and fuel. Toll charges are extra and will be billed at actuals with receipts. GST is extra.',
          ),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Our rates by region')] }),
          para(region('West', towns('West'))),
          para(region('North', towns('North'))),
          para(region('South', towns('South'))),
          para('We do not operate to Kolkata or anywhere in the east, so we are not quoting those lanes.'),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Your questionnaire')] }),
          para(`To your questions: ${a.Q1.text}; ${a.Q2.text}; and ${a.Q3.text}. Our fleet is ${a.Q4.text}. On payment, ${a.Q5.text}. Detention is charged at ${a.Q6.text}. Signed PODs are returned ${a.Q7.text}. Our damage claim ratio last year was ${a.Q8.text}.`),
          para('These rates are valid for 6 months, after which we would review them with you.'),
          para('Regards, Anand Kulkarni, Head of Key Accounts, Deccan Express Logistics'),
        ],
      },
    ],
  });
  fs.writeFileSync(path.join(out, v.file), await Packer.toBuffer(doc));
}

// D: a screenshot of a WhatsApp chat on a phone.
function htmlD() {
  const v = vendors.D;
  const q = Object.fromEntries(v.quotes.map((x) => [x.lineId, x]));
  const row = (id) => {
    const l = byId[id];
    const x = q[id];
    const veh = x.vehicleNotStated ? '' : l.tonne === 16 ? ' (16T)' : ' (9T)';
    return `${l.origin === 'Pune' ? 'Pune' : 'Hosur'}-${l.dest}${veh} ${money(x.rawPrice, 0)}`;
  };
  const chunk = (ids) => ids.map(row).join('<br>');
  const pune = D_LANES.filter((id) => byId[id].origin === 'Pune');
  const hosur = D_LANES.filter((id) => byId[id].origin === 'Hosur');
  const msg = (cls, html, time) => `<div class="m ${cls}"><div class="b">${html}<span class="t">${time}${cls === 'out' ? ' ✓✓' : ''}</span></div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; }
  body { width: 780px; font-family: -apple-system, 'Helvetica Neue', Roboto, Arial, sans-serif; background: #efe7dd; }
  .status { background: #075e54; color: #fff; font-size: 22px; padding: 10px 26px 0; display: flex; justify-content: space-between; }
  .bar { background: #075e54; color: #fff; padding: 16px 22px 18px; display: flex; align-items: center; gap: 18px; }
  .av { width: 64px; height: 64px; border-radius: 50%; background: #c9d6cf; color: #075e54; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 26px; }
  .nm { font-size: 30px; font-weight: 600; } .sub { font-size: 21px; opacity: 0.85; }
  .chat { padding: 18px 20px 26px; background-image: radial-gradient(rgba(0,0,0,0.035) 1.5px, transparent 1.5px); background-size: 22px 22px; }
  .day { text-align: center; margin: 6px 0 14px; } .day span { background: #d6ecf3; color: #46626d; font-size: 20px; padding: 6px 16px; border-radius: 10px; }
  .m { display: flex; margin: 9px 0; } .m.out { justify-content: flex-end; }
  .b { max-width: 600px; padding: 12px 16px 10px; border-radius: 12px; font-size: 25px; line-height: 1.42; background: #fff; color: #111; box-shadow: 0 1px 1px rgba(0,0,0,0.15); }
  .out .b { background: #dcf8c6; }
  .t { display: block; text-align: right; font-size: 17px; color: #7a8a80; margin-top: 4px; }
  </style></head><body>
  <div class="status"><span>7:42</span><span>5G ▮▮▮ 61%</span></div>
  <div class="bar"><div class="av">JA</div><div><div class="nm">Mahesh Jai Ambe Transport</div><div class="sub">last seen today at 7:38 pm</div></div></div>
  <div class="chat">
    <div class="day"><span>20 October 2026</span></div>
    ${msg('out', 'Mahesh bhai, pls send your rates for our RFQ-2026-FRT-007 lanes. Per trip, 32 ft closed body.', '4:15 pm')}
    ${msg('in', 'Ok sir sending. Rates per trip', '6:52 pm')}
    ${msg('in', chunk(pune), '7:05 pm')}
    ${msg('in', chunk(hosur), '7:11 pm')}
    ${msg('in', 'Other lanes we are not doing sir. Toll extra as per actual. Detention 1500 per day after 1 day', '7:12 pm')}
    ${msg('out', 'GPS, insurance, national permit? Need answers to the questionnaire also.', '7:20 pm')}
    ${msg('in', 'Will send tomorrow sir', '7:38 pm')}
  </div></body></html>`;
}

function makeE(out) {
  const v = vendors.E;
  const text = `From: Sandeep Patil <sandeep@shaktilogistics.example>
To: logistics@suryodaya.example
Date: Wed, 21 Oct 2026 10:26:03 +0530
Subject: Re: RFQ-2026-FRT-007 FTL contract FY 26-27

Dear Sir,
Current contract rates plus 6% on all lanes. We don't serve the south lanes.
${v.answers.Q1.text} ${v.answers.Q2.text} ${v.answers.Q3.text}
Tolls included as today.

Regards
Sandeep Patil
Shakti Logistics, Pune
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
  const pageD = await browser.newPage({ viewport: { width: 780, height: 1400 }, deviceScaleFactor: 1.5 });
  await pageD.setContent(htmlD());
  await pageD.screenshot({ path: path.join(out, vendors.D.file), type: 'png', fullPage: true });
  await pageD.close();
}
