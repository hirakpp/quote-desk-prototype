// Hand check: compare an extracted grid against a dataset's answer key and count cells.
// This script is the only thing that reads the answer keys. The app never does.
//
//   node scripts/handcheck.mjs --dataset packaging --selftest
//       No model. Feeds a perfect reading built from the answer key through normalize.ts.
//       Only proves the conversion code is right. It says nothing about extraction.
//   node scripts/handcheck.mjs --dataset packaging --from ~/Downloads/extractions.json
//       Check the extractions the app produced (Results, Export, "Extraction JSON").
//   ANTHROPIC_API_KEY=... node scripts/handcheck.mjs --dataset packaging --live [--provider anthropic] [--model id]
//   OPENAI_API_KEY=...    node scripts/handcheck.mjs --dataset packaging --live --provider openai --model <id>
//       Run the five sample files through the same extraction prompt from Node, then check.
//   --dataset all runs every dataset (selftest only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGrid, isUnconfirmed } from '../src/lib/normalize.ts';
import { aggregate, awardScenario } from '../src/lib/analysis.ts';
import { emptyDecisions } from '../src/lib/types.ts';
import { toExtraction } from '../src/lib/extract.ts';
import { toRaw } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const want = arg('--dataset') ?? 'packaging';
const all = fs.readdirSync(path.join(here, 'datasets')).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, ''));
const ids = want === 'all' ? all : [want];

async function liveReplies(ds, samples, providerId, model) {
  const XLSX = await import('xlsx');
  const mammoth = (await import('mammoth')).default;
  const { extractDocument } = await import('../src/lib/extract.ts');
  const { anthropic } = await import('../src/lib/llm/anthropic.ts');
  const { openai } = await import('../src/lib/llm/openai.ts');
  const provider = providerId === 'openai' ? openai : anthropic;
  const key = providerId === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error(`Set ${providerId === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} in the environment for --live.`);
  const replies = [];
  for (const v of Object.values(ds.vendors)) {
    const buf = fs.readFileSync(path.join(samples, v.file));
    const ext = v.file.split('.').pop();
    let parts;
    let docText;
    // Same text shapes as src/lib/files.ts produces in the browser.
    if (ext === 'xlsx') {
      const wb = XLSX.read(buf, { type: 'buffer' });
      docText = wb.SheetNames.map((n) => `=== Sheet: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`).join('\n\n');
      parts = [{ kind: 'text', text: `Spreadsheet contents, one sheet at a time, as CSV:\n\n${docText}` }];
    } else if (ext === 'docx') {
      docText = (await mammoth.extractRawText({ buffer: buf })).value.trim();
      parts = [{ kind: 'text', text: `Word document text:\n\n${docText}` }];
    } else if (ext === 'pdf') {
      parts = [{ kind: 'pdf', fileName: v.file, base64: buf.toString('base64') }];
    } else if (ext === 'jpg' || ext === 'png') {
      parts = [{ kind: 'image', mediaType: ext === 'png' ? 'image/png' : 'image/jpeg', base64: buf.toString('base64') }];
    } else {
      docText = buf.toString('utf8').trim();
      parts = [{ kind: 'text', text: `Email or text reply:\n\n${docText}` }];
    }
    const t0 = Date.now();
    process.stdout.write(`extracting ${v.id} (${v.file}) ... `);
    try {
      const extraction = await extractDocument({ provider, key, model }, ds.rfx, parts, v.file);
      console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s, ${extraction.items.length} items`);
      replies.push({ id: v.id, vendorName: v.name, fileName: v.file, format: v.format, source: 'sample', status: 'done', extraction, docText, provider: providerId, model });
    } catch (e) {
      console.log(`FAILED: ${provider.explainError(e)}`);
    }
  }
  fs.writeFileSync(path.join(here, 'last-live-extractions.json'), JSON.stringify(replies, null, 2));
  return replies;
}

for (const id of ids) {
  const ds = await import(`./datasets/${id}.mjs`);
  const samples = path.join(here, '..', 'public', 'samples', id);
  const rfx = ds.rfx;
  let replies;
  let mode;
  if (args.includes('--selftest')) {
    mode = 'SELFTEST (no model, perfect reading built from the answer key and written in the flat schema the model uses; checks conversion code only)';
    replies = Object.values(ds.vendors).map((v) => ({ id: v.id, vendorName: v.name, fileName: v.file, format: v.format, source: 'sample', status: 'done', extraction: toExtraction(toRaw(ds.perfectExtraction(v))) }));
  } else if (arg('--from')) {
    mode = `extractions from ${arg('--from')}`;
    const raw = JSON.parse(fs.readFileSync(arg('--from'), 'utf8'));
    replies = Array.isArray(raw) ? raw : raw.replies;
  } else if (args.includes('--live')) {
    const providerId = arg('--provider') ?? 'anthropic';
    const model = arg('--model') ?? (providerId === 'anthropic' ? 'claude-opus-5-5' : undefined);
    if (!model) {
      console.log('Give --model for OpenAI. Model ids are not hardcoded here.');
      process.exit(1);
    }
    mode = `LIVE extraction with ${providerId} / ${model}`;
    replies = await liveReplies(ds, samples, providerId, model);
  } else {
    console.log('Usage: --dataset <id|all> then --selftest | --from <file.json> | --live [--provider anthropic|openai] [--model id]');
    process.exit(1);
  }

  const grid = buildGrid(rfx, replies, emptyDecisions());
  console.log(`\n=== ${id}: ${mode}`);
  console.log('Checked with default decisions: nothing accepted, a conditional discount not applied.\n');

  const tot = { right: 0, wrongFlagged: 0, wrongSilent: 0, cells: 0, amber: 0, underRule: 0 };
  const problems = [];
  for (const v of Object.values(ds.vendors)) {
    const row = grid.cells[v.id];
    const t = { right: 0, amber: 0, underRule: 0, wrongFlagged: 0, wrongSilent: 0 };
    if (!row) {
      console.log(`${v.id} ${v.name}: NOT EXTRACTED`);
      continue;
    }
    const wantPrice = ds.expected(v);
    for (const l of rfx.lineItems) {
      const c = row[l.id];
      const w = wantPrice[l.id] ?? null;
      tot.cells++;
      const tol = w == null ? 0 : Math.max(0.011, Math.abs(w) * 0.00002);
      const same = w == null ? c.unitPrice == null : c.unitPrice != null && Math.abs(c.unitPrice - w) <= tol;
      // "Flagged" means amber: the cell itself asks for the buyer's eyes. A quiet rule marker does not count.
      const amber = c.check === 'look' || c.check === 'no_price';
      if (amber) t.amber++;
      if (c.ruleOpen) t.underRule++;
      if (same) t.right++;
      else if (amber) {
        t.wrongFlagged++;
        problems.push(`  flagged  ${v.id} ${l.id}: got ${c.unitPrice}, answer key ${w}. Doubts: ${c.doubts.map((r) => r.code).join(',')}`);
      } else {
        t.wrongSilent++;
        problems.push(`  SILENT   ${v.id} ${l.id}: got ${c.unitPrice} (${c.check}${c.ruleOpen ? ', under an open rule' : ''}), answer key ${w}`);
      }
    }
    for (const k of Object.keys(t)) tot[k] += t[k];
    const vs = grid.vendors.find((x) => x.replyId === v.id);
    const wantGate = v.gate ? v.gate : !v.answers ? 'not_answered' : Object.values(v.answers).some((a) => a.meets === 'no') ? 'fail' : 'pass';
    const termBits = [
      `freight ${vs.freight}${vs.freight === v.terms.freight ? '' : ` (KEY ${v.terms.freight})`}`,
      `gate ${vs.gate}${vs.gate === wantGate ? '' : ` (KEY ${wantGate})`}`,
      `discount ${vs.discount ? vs.discount.percent + '%' : 'none'}${(vs.discount?.percent ?? 0) === (v.terms.discountPct ?? 0) ? '' : ` (KEY ${v.terms.discountPct}%)`}`,
    ];
    console.log(
      `${v.id} ${v.name.padEnd(32)} right ${String(t.right).padStart(2)}/${rfx.lineItems.length} | amber ${String(t.amber).padStart(2)} | under an open rule ${String(t.underRule).padStart(2)} | wrong but amber ${t.wrongFlagged} | wrong and NOT amber ${t.wrongSilent} | ${termBits.join(', ')}`,
    );
  }
  console.log(`\nTOTAL over ${tot.cells} cells: right ${tot.right} | wrong but amber ${tot.wrongFlagged} | wrong and not amber ${tot.wrongSilent} | amber cells ${tot.amber} | cells under an open rule ${tot.underRule}`);
  const toAccept = grid.rules.filter((r) => !r.accepted);
  console.log(`Rules to accept: ${toAccept.length}. ${toAccept.map((r) => `${r.replyId}:${r.code}(${r.lineIds.length})`).join(' ')}`);
  if (problems.length) console.log('\nDetails:\n' + problems.slice(0, 60).join('\n'));
  console.log('');
  for (const line of ds.checks(grid, { awardScenario, aggregate, isUnconfirmed, buildGrid, replies, emptyDecisions })) console.log(line);
}
