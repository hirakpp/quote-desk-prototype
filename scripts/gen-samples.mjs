// Renders each dataset's RFx and five vendor reply files into public/samples/<id>/,
// writes public/samples/index.json, and writes the answer key to scripts/truth/<id>.json
// (which stays in scripts/).
// Run: node scripts/gen-samples.mjs [--dataset packaging|it-hardware|freight|mro-spares]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.join(here, '..', 'public', 'samples');
const args = process.argv.slice(2);
const only = args.includes('--dataset') ? args[args.indexOf('--dataset') + 1] : null;

const DATASET_IDS = fs
  .readdirSync(path.join(here, 'datasets'))
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => f.replace(/\.mjs$/, ''));

const order = ['packaging', 'it-hardware', 'freight', 'mro-spares'];
const ids = [...order.filter((id) => DATASET_IDS.includes(id)), ...DATASET_IDS.filter((id) => !order.includes(id))];

const browser = await chromium.launch();
const index = [];
for (const id of ids) {
  const ds = await import(`./datasets/${id}.mjs`);
  // index.json carries questions only. No answers, no expected numbers.
  index.push({ ...ds.meta, rfxId: ds.rfx.id, lines: ds.rfx.lineItems.length, vendors: Object.keys(ds.vendors).length, questionCount: ds.rfx.questionnaire.length });
  if (only && only !== id) continue;
  const out = path.join(samples, id);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'rfx.json'), JSON.stringify(ds.rfx, null, 2));
  // Manifest of sample replies. `hard` says what is awkward about the file, never what it contains.
  const manifest = Object.values(ds.vendors).map((v) => ({ vendorId: v.id, vendorName: v.name, file: v.file, format: v.format, hard: v.hard ?? '' }));
  fs.writeFileSync(path.join(out, 'replies.json'), JSON.stringify(manifest, null, 2));
  fs.mkdirSync(path.join(here, 'truth'), { recursive: true });
  fs.writeFileSync(path.join(here, 'truth', `${id}.json`), JSON.stringify({ vendors: ds.vendors }, null, 2));
  await ds.render(out, browser);
  console.log(id, 'wrote', fs.readdirSync(out).join(', '));
}
await browser.close();
fs.writeFileSync(path.join(samples, 'index.json'), JSON.stringify(index, null, 2));
console.log('index.json:', index.map((d) => d.id).join(', '));
