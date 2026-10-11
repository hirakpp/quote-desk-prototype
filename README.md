# Kill the Quote Spreadsheet (prototype)

Aerchain PM take-home. A static site: pick a sourcing event, read five vendor replies in five
formats, see the lowest award you can make and what is left to confirm, compare them in one grid
with a source for every cell, and ask an analyst questions.
The assignment is in `brief/BRIEF.md`, the plan in `BUILD_PLAN.md`, what was decided and measured in
`NOTE.md`.

## Models and keys

Bring your own key, for Anthropic or OpenAI. You pick the provider and paste that provider's key in
the app. The key is kept in this browser's `localStorage` and sent only to the provider you picked
(`api.anthropic.com` or `api.openai.com`), straight from the browser. There is no backend and no
relay. Models are listed from the provider with your key. No OpenAI model id is hardcoded.

You can browse every RFx and raw vendor file without a key. Reading a file or asking a question needs
one.

## Run

```
npm install
npm run dev        # http://localhost:5173
npm run build      # static output in dist/
```

## Deploy

It is a static site, so any static host works: build command `npm run build`, output directory
`dist`. `vercel.json` already says this, so Vercel needs no settings.

### GitHub, then Vercel (no terminal needed)

1. **Put it on GitHub.** The easy way is the free GitHub Desktop app: File, "Add local
   repository", pick this folder, let it create the repository, then "Publish repository". Keep
   "Keep this code private" ticked (see the note below).
   Without the app: on github.com make a new repository, click "uploading an existing file", and
   drag in everything inside this folder. The website takes at most 100 files at a time, and
   this folder has just over 100, so drag `src` first, commit, then drag the rest and commit.
   Do not upload `node_modules` or `dist` if they exist.
2. **Deploy on Vercel.** Sign in at vercel.com with the same GitHub account, click "Add New",
   "Project", pick the repository and click "Deploy". Leave every setting as it is. About a
   minute later Vercel gives a link.
3. **Use it.** Open the link. Everything can be browsed without a key. To read vendor files or ask
   the analyst, paste an Anthropic or OpenAI key in the app. The key stays in that browser.

There are no environment variables to set, and no key belongs in GitHub or in Vercel.

**Keep the repository private, or know what is in it.** The folder holds the answer keys
(`scripts/truth/`) and the working notes (`BUILD_PLAN.md`, `NOTE.md`, `archive/`). None of that
is in the deployed site, which only serves `dist`. A public repository would show all of it.
A private repository deploys on Vercel just the same.

### From a terminal

`npx vercel --prod` or `npx netlify deploy --prod --dir=dist` (both need a login).

## Sample data

Four sourcing events, each with 30 lines, 5 vendors, a questionnaire with a quality gate, and five
reply files: `packaging`, `it-hardware`, `freight`, `mro-spares`.

```
node scripts/gen-samples.mjs                       # all datasets
node scripts/gen-samples.mjs --dataset freight     # one
```

```
scripts/datasets/<id>.mjs      the RFx, the reference prices, what each vendor really quoted, and how its files are drawn
scripts/truth/<id>.json        answer key. Never imported by src/, never copied to public/
public/samples/index.json      one entry per dataset: title, buyer, rough value, summary, edges, questions. No answers
public/samples/<id>/           rfx.json, replies.json, the five vendor files
```

## Hand check

```
node scripts/handcheck.mjs --dataset packaging --selftest                  # no model, conversion code only
node scripts/handcheck.mjs --dataset all --selftest
node scripts/handcheck.mjs --dataset packaging --from ~/Downloads/extractions.json   # file from Compare, Export
ANTHROPIC_API_KEY=... node scripts/handcheck.mjs --dataset packaging --live
OPENAI_API_KEY=...    node scripts/handcheck.mjs --dataset packaging --live --provider openai --model <id>
```

It prints, per vendor and in total: cells right, wrong but amber, wrong and not amber, and how many
cells sit under a rule nobody has accepted. It then runs each dataset's own checks (for example the
VP question against a hand calculation from the answer key).

## Where things are

- `src/config.ts`: default model ids, fixed currency rates, the outlier factor, the reference-price threshold.
- `src/lib/llm/`: the provider layer. `types.ts` is the neutral interface, `anthropic.ts` and `openai.ts` are the adapters, `index.ts` holds the key slots.
- `src/lib/extract.ts`: the one model call per document, and its JSON schema.
- `src/lib/normalize.ts`: units, currency, discount, references, quantity breaks, minimum orders, rules, doubts, blockers, money units. No model.
- `src/lib/analysis.ts`: aggregate, award scenario, chart data. No model.
- `src/lib/analyst.ts`, `src/lib/copilot.ts`, `src/lib/toolloop.ts`: the two chat loops and their tools.
- `src/lib/decisions.ts`: every buyer decision as a small change that can be undone.
- `src/components/`: `Home`, `DraftView`, `RepliesView`, `Decide` (the answer, what is left to confirm, the vendors), `Compare` (with `PricesGrid`, `TermsTab`, `SourcePanel`), `AskView`. `ui.tsx` holds the shared controls, including `Money`, the one component every rupee total is drawn with.
- `src/index.css`: the design tokens. `design/vp-dark-colour.html` (Decide) and `design/pages-dark.html` (every other page) are the design reference. Nothing in `design/` is imported by `src/` or deployed.
