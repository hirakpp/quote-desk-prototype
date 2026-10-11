# Build plan: Kill the Quote Spreadsheet (one-day version)

Aerchain PM take-home. Brief: `brief/BRIEF.md`. Revised 2026-10-09 for three constraints:

1. **One day, rough prototype, minimal scope.**
2. **Hosted on a website.**
3. **Bring your own key.** Whoever opens the site pastes their own Anthropic API key. No key
   ships with the app.

The longer plan this replaces is in `archive/BUILD_PLAN-full-scope.md`. It's useful later as the
"what we left out" list. Nothing has been built or tested yet.

> **Status, 2026-10-10.** Part 1 (sections 1 to 9) is built: `src/`, `scripts/` and
> `public/samples/` exist and the app renders every screen locally. The hand check numbers in
> `NOTE.md` are still blank. **Part 2 (sections 10 to 21) is the next build.** It changes the
> flow and the results screens, opens the model layer to OpenAI, and adds two datasets. Where
> Part 2 and Part 1 disagree, Part 2 wins. Start at section 10.

## 1. What stays the same

The brief grades ugly edges, trust and judgment, not the happy path. So even the rough version
keeps three rules:

1. **The model reads. Code computes.** Claude extracts and matches lines. Unit and currency
   conversion, totals and award scenarios are plain functions.
2. **Every number shows its source.** Click a cell, see the vendor's own words it came from and
   the conversion applied.
3. **Unsure is visible.** A cell is `ok`, `needs review` or `missing`. Nothing is filled silently.

And the brief's one rule: extraction and reasoning are real model calls. No hardcoded answers.

## 2. Architecture: a static site, no backend

```
Browser only
  key gate ─> RFx co-pilot ─> "send" (stub) ─> sample replies / upload
                                                    │
                    parse file in browser ─> Claude (read + match) ─> checks + normalize (code)
                                                    │
                                 comparison grid (state + source per cell)
                                                    │
                          analyst chat (tool loop) ─> text / table / chart / XLSX
```

| Choice | Decision | Why |
|---|---|---|
| App | Vite + React + TypeScript + Tailwind, single-page app | Static files. Deploys anywhere in minutes. No server to break in a demo. |
| Model calls | Straight from the browser to the Anthropic API with the user's key | No backend, no server timeouts on slow extraction calls, and the key never touches a server we run. |
| Key handling | First screen asks for the key. Kept in the browser's `localStorage` only. A "forget key" button. Never in the repo, the build, a URL or a log. | This is the handover requirement. |
| Storage | Browser `localStorage` for the RFx, extraction results and chat. "Reset demo" button. | No database to host. Extraction results survive a reload, so the demo doesn't re-extract every time. |
| File parsing | SheetJS for Excel, mammoth for Word, both in the browser. PDF and photo go to Claude as-is. Email is text. | No server needed. |
| Hosting | Vercel or Netlify static deploy | Free tier is enough for a static site. |
| Charts / export | Recharts, one bar chart type. XLSX export via SheetJS. | Minimum that satisfies "tables, charts, exports". |

**Likely:** the Anthropic API accepts direct browser calls when the SDK is created with its
explicit browser opt-in flag. This is from my training knowledge, not checked today. The builder
confirms it with `/claude-api` in the first hour. If it's wrong, add one tiny serverless proxy
route that forwards the request with the user's key from a header and stores nothing. Everything
else in this plan is unchanged.

**Assumption:** I am proceeding on the basis that model IDs are `claude-opus-5-5` (default) and
`claude-sonnet-5-5` (faster option), set in one config file with a switch in settings. If this is
wrong, change the config file. Take IDs and the PDF/image input shapes from `/claude-api`.

**Tell the person receiving it:** the key sits in their browser and calls are billed to them. A
key with a spend limit is the sensible choice. Put one line saying this on the key screen.

## 3. Scope

**In (the minimum that is still "one flow, end to end"):**
- Key screen.
- RFx co-pilot: chat that fills a structured draft (line items, questionnaire, terms). Plus a
  "load sample RFx" button so the demo doesn't depend on it.
- Stub send: a button, then five sample replies appear in an inbox. Labeled as simulated.
- Upload your own vendor file.
- Extraction of all five formats, normalization, checks.
- Comparison grid, 30 lines × 5 vendors, with cell states and click-to-source.
- A flags list with confirm / edit.
- Questionnaire answers beside the prices, with a pass/fail on the quality-gate questions.
- Analyst chat with award scenario, one chart type, XLSX export.

**Cut for the one-day build (say so in the one-page note):**
- Database, accounts, real email, multiple RFx.
- Formal eval harness and held-out fixtures. Replaced by a hand check, see section 6.
- Second independent read of each price. Code checks only.
- Highlighting the exact region of a PDF or photo. Show the quoted text and the document side by
  side.
- Award memo PDF, sensitivity tool, clarification-email workflow (the analyst can still draft one
  as plain text if asked), editable FX and assumptions panel (show the FX rate used, fixed).
- Review queue sorted by rupee impact. A plain list is enough.

## 4. Dataset

Corrugated packaging, Indian D2C/FMCG buyer, INR. Generated once by local Node scripts in
`scripts/`, output committed to `public/samples/`.

- **RFx:** 30 SKUs (3-ply, 5-ply, 7-ply boxes, a few mailers), each with dimensions, ply, unit
  weight in grams, annual volume. Total near ₹4 crore (about 20 lakh boxes at an average near ₹20:
  2,000,000 × ₹20 = ₹4.0 crore). 8 questionnaire questions, 3 marked as the quality gate.
- **Last year's prices** per line. Real app data. Vendor E's email needs it.
- **Truth file** `scripts/truth.json`: what each vendor really quoted. The fixture scripts render
  from it. **It stays in `scripts/` and is never imported by `src/` or copied to `public/`.** The
  grid is filled only by extraction.

| Vendor | File | Edge it carries |
|---|---|---|
| A | Excel, own layout and SKU codes | Lines must be matched by description. Some prices "per 100 pcs". |
| B | PDF on letterhead | 4% discount only in a footnote. |
| C | Word doc, prices in paragraphs | Quoted in USD. |
| D | Photo of a printed rate card, at an angle | 27 of 30 lines. "Per box" means a bundle of 25 on the mailers. No questionnaire answers. |
| E | Three-line email | "₹42/kg for the 5-ply, 38 for the 3-ply, rest same as last year, freight extra." |

Make the cheapest vendor overall one that fails a quality-gate question, so the VP's question from
the brief changes the answer.

Cheap way to make the files: ExcelJS for A, the `docx` package for C, a text file for E. For B
and D use Playwright: render an HTML page and save as PDF for B, and for D screenshot the rate
card with a CSS 3D tilt, slight blur and a desk-colored background. No image-processing library
needed. Open each file and look at it before moving on.

## 5. How the two AI loops work

**Extraction (per document, one model call).** Input: the file, the RFx line list. Output, as a
strict JSON schema: for each quoted item, the matched RFx line (or none), raw price exactly as
written, raw unit, raw currency, a short quote of the source text, and a note on anything odd.
Also questionnaire answers with quotes, document-level terms (freight, GST, discount, validity),
and references the vendor made without stating a value ("same as last year").

Then code, no model:
- Convert units (per 100, per bundle, per kg via unit weight) and currency (fixed rate, shown).
- Resolve "same as last year" from the history file and mark those cells as such.
- Flag a cell `needs review` when: price is more than 3x or under 1/3 of the line's median across
  vendors, the unit differs from the RFx unit, the currency isn't INR, a discount is conditional,
  or the model left a note. RFx lines with no quote become `missing`.
- Vendor-level banners: lines quoted out of 30, freight not included, questionnaire not answered.

**Analyst (tool loop, max 6 tool calls per question).** Tools:
- `get_grid`: the normalized grid and questionnaire results as compact JSON, with filters.
- `aggregate`: group and sum/min/avg in code (by vendor, by ply, vs last year).
- `award_scenario`: cheapest per line under constraints (which vendors are eligible, max vendors,
  whether to use `needs review` cells). Returns the split, totals, and savings vs last year and vs
  the best single vendor.
- `render_chart`: a bar chart spec the UI draws.

Rules in the system prompt and enforced by design: figures come only from tool results, the answer
says how many cells it used were unreviewed, and if the data can't answer the question it says so.
Show the tool calls under each answer in a collapsible "how I got this".

**Co-pilot.** Same loop pattern with tools that edit the RFx draft (`set_line_items`,
`set_questionnaire`, `set_terms`). Keep it small.

## 6. One-day sequence

Hours are rough estimates, not measurements. About 10.5 in total. Deploy at the end of block 1 so
hosting problems show up in hour one, not hour ten.

| # | Block | Est. | Done when |
|---|---|---|---|
| 1 | Scaffold, key screen, one test call from the browser, first deploy | 1h | The hosted URL takes a key and gets a reply from Claude |
| 2 | Dataset and the five sample files | 2h | All five open and look like real vendor replies |
| 3 | Extraction, normalize, checks | 2.5h | All five extract. Every planted edge in section 4 is either handled correctly or flagged |
| 4 | Grid, cell states, click-to-source, flags list, questionnaire panel | 1.5h | A buyer can see each edge without opening the raw file |
| 5 | Analyst chat, award scenario, chart, XLSX export | 1.5h | The VP question returns a split whose total matches a hand calculation |
| 6 | Co-pilot, stub send and inbox, upload | 1h | Sample flow runs from a blank page to an award |
| 7 | Reset button, loading and error states, redeploy, one cold run on the hosted URL, one-page note | 1h | A fresh browser with a fresh key completes the flow |

**Hand check that replaces the eval (do it, it takes 15 minutes):** after block 3, compare the
extracted grid against `scripts/truth.json` by eye or with a throwaway script. Write down the real
count: cells right, cells wrong but flagged, cells wrong and not flagged. That last number is the
one that matters, and it goes in the note as measured, whatever it is.

**If the day runs short, drop in this order:** co-pilot (keep "load sample RFx"), chart, upload,
XLSX export. Keep extraction, cell states, sources and the award scenario to the end.

## 7. Demo questions for the recording

1. "What came back, and what can't I trust yet?"
2. "What if we split it, cheapest per line, but only among vendors who cleared the quality
   questionnaire?" (the brief's own question)
3. "What does that cost versus giving it all to one vendor?"
4. "Cap it at two vendors."
5. "Where are prices up most against last year?" (chart)
6. "Which vendor has the best on-time delivery?" (no such data, the system should say so)

Added with Part 2, two per new dataset, the second one being a question the data can't answer:

- IT hardware: "Cheapest per line among vendors who cleared the quality gate, counting only
  exact-match models." and "Which vendor has the fewest warranty claims?" (no such data)
- Freight: "Cheapest per lane among carriers who cleared the quality gate, but nobody gets more
  trucks than they said they can supply." and "What will tolls add on Deccan Express's lanes?"
  (no toll data was asked for)

Added with Part 3:

- MRO spares: "What is the smallest set of vendors that covers all 30 lines?", "What do the
  minimum order quantities cost us in the first year?" and "Which equivalent brands has
  maintenance approved?" (no approved-brand list was asked for)

## 8. One-page note skeleton

- What I decided: a rough build that spends its day on uncertainty handling, not breadth.
- Four calls and why: model reads / code computes; flags from code checks, not model confidence;
  no auto-award; browser-only with bring-your-own key.
- What the hand check found, real numbers.
- Left out on purpose: section 3's cut list, and what the fuller version adds (see `archive/`).
- Optional, only if building bears it out: the harder problem may be making quotes comparable
  (missing lines, unknown freight) before any analysis. That's a hypothesis, not a finding.

## 9. Risks

| Risk | Handling |
|---|---|
| Browser calls to the API are blocked | Checked in hour one. Fallback is the pass-through proxy in section 2. |
| Photo extraction misreads digits | Expected. The bar is that odd values get flagged by the median check. |
| A reviewer uploads a format it hasn't seen | Wrap extraction in error handling. Failure shows "couldn't read this, here's why", never a blank grid or a crash. |
| Invalid or out-of-credit key | Catch auth and rate-limit errors and show a plain message on the key screen. |
| `localStorage` fills up with file data | Store extraction results only, not raw files. Sample files reload from `public/samples/`. |
| Slow extraction on stage | Results persist after the first run. A "re-run" button on each document proves it's live. |

**Still open:** which host (Vercel or Netlify) and whose account it deploys from. The deploy step
needs a login from a human.

---

# Part 2: easier to use, less to read, open model, more datasets

Added 2026-10-10 after a design review of the built prototype. Nothing in Part 2 has been built
or tested. Hours are reasoned estimates, not measurements.

## 10. What changes, and what you need to decide

Four changes, in the order they should be built:

1. **Flow.** No key wall. Pick a sourcing event, press one button, land on a result.
2. **Results.** Lead with the verdict and the handful of things to confirm. The 150-cell grid
   becomes the reference view, not the first view. Analyst answers get a fixed, short shape.
3. **Open model layer.** Anthropic or OpenAI, the user's choice, each on their own key.
4. **Datasets.** Two more sourcing events (IT hardware, freight lanes), each built so the obvious
   "cheapest" answer is wrong for a different reason.

**Decisions for the reviewer.** The builder proceeds on the default in each row unless told otherwise.

| # | Decision | Default the builder uses | What changes if you pick the other |
|---|---|---|---|
| D1 | Does a clean code conversion still turn a cell amber? | No. See section 12. A conversion becomes one vendor-level item to accept, and the cell carries a quiet marker. | Keep v1: every converted cell is amber. The grid stays about two-thirds amber and section 12's summary has to carry the whole load. |
| D2 | If the browser can't call OpenAI directly, is a pass-through relay acceptable? | Yes, a stateless one, and the key screen says so in plain words. See section 15. | OpenAI support is dropped until there's a backend. "No server behind this page" stays true for everyone. |
| D3 | How many new datasets? | **Decided 2026-10-10: three.** IT hardware and freight lanes are built. MRO spares is now a full dataset, see section 16.3 and Part 3 block 6. | Each dataset is about 3 hours plus its hand check. One dataset saves that. |
| D4 | Is a phone layout in scope? | No. Desktop demo only. Phone gets a readable summary and review queue, the grid scrolls sideways. | A real phone layout for the grid is about 3 more hours. |
| D5 | Is a conditional discount applied before the buyer says so? | No. Kraftline's 4% depends on offtake above ₹50 lakh, which a split award may not reach. Show list price by default, with the discounted price beside it on the rule card. | Keep v1: applied by default. Totals for that vendor look lower than they may turn out. Either way, re-run the hand check, since this moves numbers. |

## 11. What the review found

Method: the designer-reviewer sub-agent (`PM-OS/sub-agents/designer-reviewer.md`) plus the
Impeccable critique, distill and onboard passes, the redesign audit and the dataviz rules. Screens
were captured from the running app at 1440 x 900. The Impeccable detector was run over `src/` and
returned no findings, which fits: the problems are in what is shown and in what order, not in
stock visual patterns.

**Caveat on the screenshots.** The Compare screen was filled from `scripts/truth.json` in a
throwaway browser profile, so it shows a perfect read with no model mistakes. A real run adds
reader notes and outliers on top of what is counted here. No analyst answer was captured, since
that needs a live key. The analyst findings come from reading the components.

**Verified** (counted in the running app or read in the code):

- 102 of 150 grid cells are amber "needs review" on a perfect read. 45 are ok, 3 are missing.
  Breakdown: A 9 (per 100), B 30 (discount), C 30 (USD), D 3 (box of 25), E 30 (22 per kg, 8 from
  last year).
- Those 102 cells are really 6 decisions. The "To review" list already groups them into 6.
- The Compare page holds about 1,650 words and is 1,762 px tall on a 900 px screen. The grid shows
  10 of 30 lines before scrolling. The review list and the questionnaire start below the fold.
- First result takes one paste, 7 clicks and two waits: save key, continue, load sample, send,
  receive, read all, open comparison. A first analyst answer is 2 more clicks and a third wait.
- **The chat box is cut off on both chat screens at 1440 x 900.** The header wraps to two rows
  (about 110 px) while `RfxTab` and `AnalystTab` size themselves with `calc(100vh-64px)`, so the
  text box and Send button fall below the screen. Whoever drives the demo can't see where to
  type. Fix this first.
- The green "lowest price" underline picks the minimum across all vendors. It ignores the quality
  gate and freight terms, so it points at prices the buyer can't simply take.
- A confirmation can't be undone. `addCodes` only adds. One wrong "Confirm all 30" stays until
  Reset.
- Buttons point the wrong way twice. With nothing drafted, the dark primary button is the disabled
  "Send to vendors" and the one that works is a small outlined button beside it. After the replies
  arrive, "Receive the five sample vendor replies" stays the dark primary and does nothing.
- "Open the comparison" appears as soon as one reply is read, so an eager click lands on a
  one-vendor grid with no note that four are missing.
- Three empty states tell the user where to go in a sentence and give no button.
- Drafting your own RFx with the co-pilot ends at "the five sample replies answer the sample RFx
  only". In a demo that's a dead end unless you have vendor files ready to upload.
- Text goes down to 10 and 11 px in the grid tags, vendor headers and totals.
- Five hues carry meaning with no rule between them: slate, emerald, amber, red, indigo. Emerald
  is both "passed" and a button colour. Pass, fail and lowest price lean on colour.
- No custom focus styles. The source panel opens over the grid and covers the selected column. It
  has no Escape to close and no focus handling. Reset and forget-key use browser `confirm()`.
- "Simulated" is said in the header, on the send button and in a banner.
- An analyst answer can stack, in one bubble: the text, an award card (4 figures, a vendor table,
  a left-out line, a caveat list, a 30-row expander), a chart, download buttons, and raw tool-call
  JSON.

**Reported by the reviewer, not re-checked by me.** Confirm each before fixing:

- A review group shows the first cell's text for the whole group, so "converted using the RFx
  unit weight of 95 g" appears for 22 Sai Cartons lines when 95 g is line L01 only.
- The questionnaire table's fifth vendor column is clipped at the right edge.
- Re-reading a file may keep earlier confirmations, since decisions are keyed by cell and reason.
  A changed re-read would then inherit a confirmation nobody gave it.
- The same caveat can show three times in one analyst answer: in the prose, as a figure on the
  award card, and as a bullet under it.
- Only the last award of a turn is drawn, so the card can show a different scenario from the one
  the prose leads with.

**Likely** (design judgment, not tested with a user):

- The overload isn't volume alone. Nothing on the Compare screen says what the buyer should
  conclude or do first, so they have to read everything to find out.
- Amber has stopped carrying a signal. When two-thirds of the grid is flagged, a real problem
  (a misread digit, a price three times the median) looks the same as "this vendor quoted in USD".
- The first-run friction is the key wall plus four separate "do the next thing" buttons that sit
  in toolbar corners rather than where the eye already is.

**What works and stays:** the model reads and code computes. Every number has a source and its
arithmetic. Flags come from code checks. The "how I got this" trail exists. The copy is plain.
The source panel's content is right, it's the container that needs work.

## 12. Results: lead with the verdict

### 12.1 Split rules from doubts (decision D1)

Today one state, `needs_review`, covers two different things. Split them.

| | Rule | Doubt |
|---|---|---|
| What it is | A conversion code applied to many of one vendor's cells for one stated reason | Something wrong or unclear with one cell |
| Reason codes | `unit`, `currency`, `discount`, `last_year` | `outlier`, `note`, `duplicate`, `unreadable`, `quote_not_found`, and the new ones below |
| Where it shows | One card per vendor per rule, in "To confirm" | Amber cell, plus a card in "To confirm" |
| In the grid | Quiet marker in the cell: `÷100`, `kg`, `$`, `-4%`, `LY`. Muted ink, never amber. | Amber cell with a word and an icon |
| Buyer action | Accept the rule once, or switch it off where that makes sense (discount) | Confirm the value or correct it |

In code this is two fields on a cell instead of one state:

- **Basis**, always visible and never amber: as quoted, converted, assumed (a last-year fill, not
  a number the vendor wrote), edited by the buyer.
- **Check**: none, needs a look, no usable price, not quoted. "No usable price" (the vendor quoted
  the line but nothing readable came out) is kept apart from "not quoted".

A cell under a rule the buyer hasn't accepted still counts as unconfirmed everywhere totals are
quoted, and that vendor's total is marked provisional. The `LY` mark stays on a last-year fill
even after the rule is accepted, because it never becomes a number the vendor wrote.

Three details:

- **A cell under a rule turns amber only when its converted price fails a check.** Mixed vendors
  (Shree Balaji's 9 lines per 100, Maruti's 3 lines per box of 25) stay one rule card each that
  lists its lines.
- **A conditional discount is a decision, not a doubt** (D5). Its card shows both prices and asks
  the buyer to choose.
- **Clear a file's confirmations when it's read again.** Accepting and confirming both get an
  inline Undo.

On the packaging sample with a perfect read this takes the screen from 102 amber cells to 0, with
6 rule cards and 3 missing cells. **Verified** as arithmetic on the current data. **Uncertain:**
what a live read shows. Measure it in block 10.

This keeps rule 3 of Part 1 ("unsure is visible, nothing is filled silently"). Every converted
cell still shows its marker, its source words and its arithmetic. What changes is that amber now
means "this one needs your eyes".

**One gap to close.** The outlier check (3x from the line median) catches a missed "per 100" or
"box of 25". It doesn't catch a per-kg price mistaken for per-piece on a carton near 1 kg, where
the error is under 3x. v1 hid this by flagging every converted cell. Add a second net: flag a
cell when it's more than 40% away from last year's price for that line. **Assumption:** I'm
proceeding on 40% as a starting threshold. If the hand check shows it fires on correct prices,
widen it, and record the number used in `src/config.ts`.

### 12.2 The Results screen (replaces the Compare tab)

Three layers. Each layer answers the question the one above it raises.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ 5 replies read. 3 quoted all 30 lines. 2 cleared the quality gate.            │
│ 6 things to confirm before these numbers are safe.     [Review 6]  Ask ›      │
├───────────────────────────────────────────────────────────────────────────────┤
│ Vendor             Lines    Quality gate    Freight     Like-for-like total   │
│ Shree Balaji       30/30    ✓ Passed        Included    ₹…                    │
│ Kraftline          30/30    ✕ Failed        Included    ₹…                    │
│ Maruti             27/30    – No answer     Extra       ₹…                    │
├───────────────────────────────────────────────────────────────────────────────┤
│  To confirm (6)  │  Prices  │  Questionnaire and terms                        │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Layer 1, verdict strip.** One or two sentences built by code from the grid, no model call.
One primary button. The count falls as the buyer confirms things, and the sentence changes to
"Everything is confirmed" at zero.

**Layer 2, vendors at a glance.** One row per vendor, five columns. Row click opens a vendor
panel with the file, the warnings, unmatched items and notes that v1 packs into the column
header. "Like-for-like total" is the annual cost on the lines every vendor quoted, so the totals
can be compared. v1's "annual cost of quoted lines" stays in the vendor panel with its warning.

**Layer 3, three tabs.** Open on "To confirm" while anything is open, otherwise on "Prices".

- **To confirm.** One card per item, in three groups: blockers first (gate failed, freight extra,
  lines not quoted, unmatched items), then rules, then cell doubts. Inside a group, sorted by
  rupees a year at stake, biggest first (this brings back the review queue cut in section 3).
  Each card: what the vendor wrote, what code did, the amount at stake, one primary action. The
  card's text describes the whole group, not its first cell. Line ids read "all 30 lines" or
  "L27 to L29", not a wall of chips. Keyboard: `J`/`K` to move, `Enter` to accept, `E` to edit.
  Accepting shows an inline "Undo", no dialog.
- **Prices.** The grid, rebuilt for scanning:
  - Lines grouped by category (3-ply, 5-ply, 7-ply, mailers). Groups start collapsed and show a
    subtotal per vendor. Open a group to see its lines. A "Show all lines" switch for people who
    want v1's view.
  - One line per row. Description cut to one line with the size in its own column.
  - Filter chips: All, Flagged, Missing, Converted.
  - Lowest price per line marked with weight and a small dot, not an underline. It's worked out
    only among vendors whose prices can be compared (gate cleared, same freight basis), and the
    legend says so.
  - A switch between rupees and percent against last year. Last year is the buyer's real
    reference point and it isn't in the cells today.
  - Vendor column header is the name, the gate mark and one basis line. It stays sticky, and so
    does the totals row.
  - One Export menu. XLSX on top, the extraction JSON inside it.
- **Questionnaire and terms.** The v1 table, unchanged in content. Pass, fail and unclear each get
  an icon and a word. The vendor's own words move from a hover title to a click, so they work
  with a keyboard and on touch.

### 12.3 Source panel

Same content, new container.

- Docked on the right at about 440 px. The grid stays visible and scrolls the selected column
  into view. It's a panel, not an overlay.
- Order: price and state, the vendor's own words with the highlight, the arithmetic, then the
  actions in a footer that stays put. Today "I checked this, confirm" sits above the evidence it
  asks you to check. The full document sits under a "Show the whole document" expander for text
  formats and is shown directly for a PDF or photo.
- Previous and Next walk the "To confirm" list without closing the panel.
- `Esc` closes it. Arrow keys move to the next cell with the panel open. Focus goes into the
  panel on open and back to the cell on close. It has a labelled region role.

### 12.4 Analyst answers get one shape

The model ends every answer by calling a final `answer` tool instead of writing free markdown.
The UI renders it. Same on both providers.

```
answer({
  headline:   one or two sentences, the answer itself
  points:     up to 3 short supporting facts
  caveats:    up to 2, only ones that change what the buyer should do
  follow_ups: up to 3 next questions, shown as chips
})
```

Figures still come only from tool results. The system prompt keeps every rule it has today.

What the buyer sees, top to bottom:

1. The headline.
2. Up to three points.
3. **One** thing to look at: an award card, or a chart, or a small table. If a question produced
   more than one, show the last and list the others as links.
4. One caveat line, amber only when the answer rests on unconfirmed prices.
5. Follow-up chips.
6. "How I got this", closed. Open it and each step reads as a sentence ("Computed an award among
   vendors that cleared the quality gate, no cap on vendor count"). Raw JSON sits one level
   further in, behind "Show raw".

Also: cap the answer at about 720 px wide, scroll to the top of a new answer and not its bottom,
and say each caveat once. When a card is shown, the prose explains it and doesn't repeat its
figures. Suggested questions become chips above the text box, since the side list is hidden on
narrower screens today.

**Award card, cut down.** The card is titled with its scenario, so it can't be mistaken for a
different one. Two figures (total a year, saving against last year), one horizontal
split bar showing each vendor's share with its name and amount written on it, and one line that
says what the number rests on ("uses 9 prices from a rule you haven't accepted"). The vendor
table, the left-out list and the 30 lines go behind one "Details" expander. Export stays.

**Scenario tray.** Every award the analyst computes is pinned to a rail on the right: name,
total, vendor count, difference from the first scenario. "Split among gate-cleared vendors",
"best single vendor" and "cap at two" then sit side by side without scrolling back. The tray is
filled only from tool results that already ran. Nothing is precomputed.

**Charts.** Bar and stacked bar only. One neutral series colour. Percent against last year uses
two hues with a neutral midpoint and a signed label on every bar, so direction never depends on
red and green. Never two y-axes. Each chart gets a "Show as table" switch.

## 13. Flow: one button to a result

**Home (new first screen).** No key wall.

- One line on what this is.
- A card per sourcing event (section 16). Each card: category, buyer, size, the ugly edges
  inside it, three questions it can answer.
- On each card, one primary button: **Run it end to end**. One text link on the page: "Start from
  a blank RFx" (the co-pilot).
- A slim "Connect a model" row: provider, key, test. If no key is saved, the run button opens
  this row in place.

**What works without a key:** browsing the RFx, opening the five raw vendor files, and reading
what's hard about each. This costs no model call and shows the mess before the fix. Anything
that needs a model opens the connect row where the user is, then carries on.

**Run screen.** One screen, one progress list, no clicks:

```
✓ RFx loaded: 30 lines, 8 questions
✓ Sent to 5 vendors (simulated)
✓ 5 replies received
◐ Reading   Shree Balaji    Excel   30 prices, 9 quoted per 100          18 s
◐ Reading   Kraftline       PDF     reading…
…
                                              [Open results]  appears when the first is done
```

Each row fills in with what was found as that file finishes. Files are read in parallel, as v1
already does. A failed file shows its reason and a retry on its own row and doesn't block the
others. The results screen opens by itself when the last one finishes.

**After the first run.** The four numbered tabs become a stepper, Draft, Replies, Results, Ask,
with done, current and not-yet states, and one "Next" button in the same place on every screen.
The manual path (draft with the co-pilot, send, upload a file, read one file, re-run) is all
still there. It just isn't the only way in.

**Smaller fixes.**

- The shell is a flex column and the chat panels fill what's left. No `calc(100vh-64px)`. This
  is the clipped chat box from section 11.
- Header is one row: name, stepper, a settings button. Settings holds provider, model, keys,
  reset. "Rough prototype..." leaves the header.
- A good test call goes straight in. The separate "Continue" click goes.
- One primary button per screen, and it's always the next thing that works. "Open results"
  before every file is read says "2 of 5 read".
- A draft the user wrote with the co-pilot has no sample replies. Say that on the draft screen,
  before they send, and offer upload there.
- "Simulated" is said once, as a small tag on the send step.
- Co-pilot's empty state offers three starter prompts and "Use the sample RFx". When the co-pilot
  edits the draft, the changed rows are highlighted for a moment.
- Every empty state says what will appear and gives the one button that gets there.

**Target:** paste a key, one click, wait, results. That's 1 click against 7 today. The wait is
the same, since the model calls are the same.

## 14. Visual system

This is a tool a careful buyer works in. The aim is that it reads as familiar and exact, and
that nothing decorative competes with the numbers.

- **Type.** One sans family for everything, tabular figures on every number. The family must
  contain the rupee sign (U+20B9), so check that by rendering "₹1,23,456.78" before choosing.
  Candidates to test: Geist, IBM Plex Sans. Four sizes, three weights. **Nothing under 12 px.**
- **Colour.** One neutral family (keep slate). One accent, used only for the primary action and
  the current selection. Three status colours with fixed jobs: amber means "needs you", red means
  "failed or blocking", green means "cleared". Status never appears without a word or an icon.
  Emerald stops being a button colour. Indigo goes.
- **Tokens.** Put colours, sizes and spacing in `@theme` in `src/index.css` and use those names in
  components. No raw hex in components.
- **Density.** 32 px grid rows, 13 px data text. Cards only where a boundary means something.
  No card inside a card.
- **States.** Every control has hover, focus-visible, pressed, disabled and loading. Skeleton rows
  while a file is being read. Errors appear next to the thing that failed.
- **Motion.** 150 to 200 ms, only for the panel, expanders and the progress list. Honour
  `prefers-reduced-motion`.
- **Keyboard and screen readers.** The whole first-run path works with a keyboard. Grid cells are
  buttons with a label that reads the vendor, the line, the price and the state. Contrast meets
  WCAG AA.
- **Phone (D4).** Verdict, vendors and "To confirm" stack and read well. The grid scrolls
  sideways with the line column pinned.

After building, run the Impeccable detector once over `src/` and fix what it finds:
`PM-OS/.claude/skills/impeccable/scripts/impeccable detect --json src`.

## 15. Open model layer

**Goal:** the user picks Anthropic or OpenAI, pastes that provider's key, picks a model. Every
rule in Part 1 holds on both.

### 15.1 Shape

```
src/lib/llm/
  types.ts       neutral message, tool and part types, and the Provider interface
  anthropic.ts   today's code, moved behind the interface
  openai.ts      new
  index.ts       getProvider(id)
```

```ts
type Part =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mediaType: string; base64: string }
  | { kind: 'pdf'; base64: string; fileName: string }

interface Provider {
  id: 'anthropic' | 'openai'
  listModels(key: string): Promise<{ id: string; label: string }[]>
  test(key: string, model: string): Promise<string>
  extract(a: { model; system; parts: Part[]; schema }): Promise<unknown>   // strict JSON out
  step(a: { model; system; tools; messages }): Promise<{                   // one tool-loop round
    text: string
    toolUses: { id: string; name: string; input: unknown }[]
    stop: 'end' | 'tool_use' | 'max_tokens' | 'refusal'
    carry: unknown   // the provider's own assistant turn, passed back untouched next round
  }>
  explainError(e: unknown): string
}
```

- `files.ts` returns `Part[]` instead of Anthropic content blocks.
- `toolloop.ts` keeps its logic and calls `provider.step`. `carry` is how thinking blocks
  (Anthropic) or reasoning items (OpenAI) survive between rounds.
- `extract.ts`, `analyst.ts`, `copilot.ts` keep their prompts and tool definitions. Tool schemas
  move to a neutral shape that each adapter maps.
- Anthropic-only knobs (the effort setting) live inside the Anthropic adapter.

### 15.2 OpenAI adapter

**Likely**, from training knowledge and not checked against OpenAI's docs today: the Responses
API takes a JSON schema for strict structured output, base64 PDFs as file input, images as data
URLs, and function tools. Strict mode needs every property required and no extra properties,
which `EXTRACTION_SCHEMA` already satisfies. The analyst and co-pilot tools have optional
parameters, so send those non-strict. The builder confirms each of these on OpenAI's API
reference before writing the adapter.

**I don't know** which OpenAI model IDs are current. So don't hardcode any. `listModels` calls the
provider's models endpoint with the user's key and the user picks from what their key can use.
Keep a free-text model field as the fallback. Do the same for Anthropic, with today's two IDs as
the default selection.

### 15.3 The browser question (decision D2)

**Uncertain:** whether a browser can call the OpenAI API directly. Checked today by web search,
not by running it: the OpenAI JS SDK has a `dangerouslyAllowBrowser` flag, there are 2026
developer-forum threads reporting browser calls to the Responses API failing on CORS, and one
August 2026 article says OpenAI doesn't return CORS headers for browser origins. None of that is
OpenAI's own documentation.

So this is the first thing the builder does in block 1: from the deployed site, with a real
OpenAI key, make one call. Two outcomes:

- **It works.** Build the adapter as a direct call. Nothing else changes.
- **It's blocked.** Add one relay function on the host (`/api/openai`) that forwards the request
  body and the `Authorization` header to `api.openai.com` and streams the reply back. It stores
  nothing and logs nothing. Then three things must also happen: the key screen says "OpenAI calls
  pass through a relay on this site, which forwards your request and keeps nothing"; the README
  and `NOTE.md` stop saying "no backend"; and a PDF and a photo are tested through the relay,
  because hosted functions cap request size and run time. **Likely:** the sample files fit. An
  uploaded 20 MB PDF may not.

### 15.4 Keys, state and honesty

- One key slot per provider: `rfx.key.anthropic`, `rfx.key.openai`. Move an existing `rfx.apiKey`
  into the Anthropic slot on first load.
- The connect copy names where the key goes for the provider chosen. It never says "sent only to
  api.anthropic.com" when OpenAI is selected.
- Each reply already records its model. Add the provider. Results show "read by" per vendor.
  Switching provider doesn't clear results.
- `explainError` per adapter, same plain messages: bad key, no access to this model, rate limit,
  out of credit, can't reach the API.
- If a chosen model can't take a PDF or an image, the file's row says so and suggests another
  model. It never falls back to another provider on its own.
- **The hand check runs per provider.** `NOTE.md` reports the numbers for each one that was run,
  and says which wasn't. Don't write that the two are equivalent unless both were measured.

### 15.5 Stretch: a second read

With two providers connected, a "Second opinion" button on a file reads it again with the other
provider. Cells where the two reads disagree become doubts. This is the "second independent
read" cut from Part 1, and it's now cheap. Build it only after everything else in Part 2 works.

## 16. Datasets

Three sourcing events. Same size each (30 lines, 5 vendors, a questionnaire with a quality gate,
attached documents). Each is built so the cheapest-looking answer is wrong for a different reason,
which is what makes a different kind of question worth asking.

| | Packaging (built) | IT hardware (new) | Freight lanes (new) |
|---|---|---|---|
| Buy | Annual rate contract, cartons and mailers | One-time office refresh | Annual road freight contract, full truckload |
| Line unit | Piece | Unit | Trip |
| Why "cheapest" is wrong | Cheapest vendor fails the quality gate | Cheapest prices are for substitute models | Cheapest carrier can't supply enough trucks |
| New data per line | none | Lead time, warranty, exact match or substitute, price by quantity | Transit days, trucks a month, fuel clause |
| Kind of question it opens | Split under a gate, change against last year | Filter on non-price terms, quantity what-ifs | Award under capacity, cost what-ifs |

Each keeps the brief's five formats, with the edges moved between vendors so no dataset is a
reskin of another.

### 16.1 IT hardware

Laptops in three configurations, desktops, monitors, docks, peripherals, network gear, UPS.
INR, one-time purchase. The generator tunes quantities so the total lands near ₹4 crore, the way
`VOLUME_SCALE` does today.

| Vendor | File | Edge |
|---|---|---|
| A | Excel, several sheets | Price breaks by quantity (1 to 99, 100 to 499, 500 and up). The right tier depends on the RFx quantity. |
| B | PDF | Base price, with the 3-year warranty as a separate add-on line per item. |
| C | Word | Offers "equivalent" models on 6 lines, with less memory or an older chip. Prices in USD. |
| D | Photo of a printed price list | 22 of 30 lines. Mice and keyboards priced per pack of 10. |
| E | Short email | "10% off our last PO rates for laptops. Rest as per attached list." Refers to last purchase prices. |

Quality gate: OEM-authorised reseller letter, on-site next-business-day warranty, e-waste
take-back.

Questions it opens: "Cheapest per line, counting only exact-match models." "Which lines got a
substitute, and what does the exact model cost elsewhere?" "What changes if everything has to
arrive in 21 days?" "What does a 3-year warranty add, by vendor?" "If we buy 600 laptops instead
of 400, does the winner change?" And one it can't answer: "Which vendor has the fewest warranty
claims?"

### 16.2 Freight lanes

Thirty origin and destination lanes out of two plants. Each lane has a distance, a standard load
in tonnes and trips a year. INR per trip.

| Vendor | File | Edge |
|---|---|---|
| A | Excel | Clean per-trip rates, and a trucks-a-month limit on each lane. |
| B | PDF | Rates per tonne. A footnote ties the rate to a diesel price, with a stated rise per rupee. |
| C | Word | Rates per km in a paragraph per region. Tolls extra. |
| D | Screenshot of a WhatsApp chat | Regional carrier, 18 of 30 lanes. Vehicle size not stated on some. |
| E | Email | "Current contract rates plus 6% on all lanes. We don't serve the south lanes." |

Quality gate: GPS tracking on every vehicle, transit insurance, valid national permit.

Questions it opens: "Cheapest per lane, but nobody gets more trucks than they said they can
supply." "Which lanes have only one bidder?" "What happens to the award if diesel goes up ₹5?"
"Where is the fastest carrier more than 10% dearer than the cheapest?" And one it can't answer:
"What will tolls add on vendor C's lanes?" (no toll data was asked for).

### 16.3 MRO spares (decided: build it, Part 3 block 6)

Long-tail spares where most vendors quote half the list, OEM and equivalent parts are mixed, and
minimum order quantities matter. Opens "fewest vendors that cover everything" and "what do the
minimums cost us". The reviewer confirmed this on 2026-10-10. The full spec is in section 25.

### 16.4 Files and rules

```
scripts/datasets/<id>.mjs      definition: RFx, history, what each vendor really quoted
scripts/truth/<id>.json        answer key. Never imported by src/, never copied to public/
public/samples/index.json      one entry per dataset: title, buyer, summary, edges, questions
public/samples/<id>/           rfx.json, replies.json, the five vendor files
```

- `gen-samples.mjs` and `handcheck.mjs` take `--dataset <id>`.
- The store holds a dataset id. `SAMPLE_RFX_ID` and the fixed sample paths go.
- `index.json` carries questions only. No answers, no expected numbers. The rule "no hardcoded or
  cached answers" covers every dataset.
- Open every generated file and look at it before moving on. New ones to make: a multi-sheet
  workbook, a WhatsApp-style screenshot (HTML rendered by Playwright, like the rate card).
- Every dataset gets its own hand check, and its own line in `NOTE.md`.

## 17. Engine changes the datasets need

v1 is written around "INR per piece, convert per kg by unit weight, USD only, category from ply".
Generalise the smallest amount that lets all three datasets run through one code path. After each
step, re-run the packaging self-test so v1 behaviour is known not to have moved.

| # | Change | Where | Needed by |
|---|---|---|---|
| 1 | Each line carries `measures`, a map of how much of a measure one unit holds: `{ kg: 0.095 }`, or `{ km: 1420, tonne: 9 }`. Price basis becomes `per_unit`, `per_n_units`, `per_measure` (with the measure named), `other`. `unitWeightG` becomes `measures.kg`. | `types.ts`, `extract.ts`, `normalize.ts` | Freight (per km, per tonne) |
| 2 | Currency is an ISO code. Fixed demo rates sit in a table in `config.ts`, each shown where it's used. No rate for a currency means no price and a doubt. | `config.ts`, `normalize.ts` | IT hardware |
| 3 | A line has a `category` field in the data. `lineCategory()` stops reading ply. | dataset files, `normalize.ts` | Both |
| 4 | Line attributes. The RFx declares them (`key`, `label`, `unit`, which direction is better). Each extracted item returns `attributes` as a list of `{ key, value_number, value_text, quote }`. A vendor-wide statement ("3 weeks on all items") comes back once and code applies it as a rule. | `types.ts`, `extract.ts`, `normalize.ts`, Prices grid | Both |
| 5 | Match quality: each item is `exact`, `substitute` or `unsure`, with the offered item's text. Substitute and unsure are doubts. | `extract.ts`, `normalize.ts` | IT hardware |
| 6 | Price tiers: an item can return several prices with a minimum quantity each. Code picks the tier for the RFx quantity and records it as a rule. | `extract.ts`, `normalize.ts` | IT hardware |
| 7 | A reference can carry an adjustment ("current rates plus 6%", "10% off last PO"). Code applies it to the history price and shows both numbers. | `extract.ts`, `normalize.ts` | Both |
| 8 | Optional add-ons priced per line (warranty). Kept apart from the base price, added only when a scenario asks. | `extract.ts`, `normalize.ts`, `analysis.ts` | IT hardware |
| 9 | `award_scenario` gains: `require` (filters on attributes, such as lead time at most 21), `exact_match_only`, `respect_capacity`, `quantity_overrides`, `include_addons`, and `price_adjustments` (a what-if percent on named vendors, marked as hypothetical in the result). | `analysis.ts`, `analyst.ts` | Both |
| 10 | The analyst and extraction system prompts stop naming cartons and ply. Category words come from the RFx. | `analyst.ts`, `extract.ts` | Both |

Notes for the builder:

- **Schema limit.** A comment in `extract.ts` says the Anthropic API allows at most 16 nullable or
  union-typed fields in one schema. I haven't checked that against the API docs. Attributes and
  tiers are lists for that reason, so they add no nullable fields. Confirm the limit before
  adding any.
- **Capacity.** In the freight data a carrier's limit is per lane, so filling each lane cheapest
  first up to the limit and spilling to the next carrier is exact. A fleet-wide limit across
  lanes is a harder problem and is out of scope. Say so in the tool's description so the analyst
  doesn't claim more.
- **What-ifs are labelled.** A scenario with `price_adjustments` or `quantity_overrides` returns
  a flag, and the award card shows "what-if" beside the total.
- The model still only reads and matches. Tier choice, add-ons, adjustments, capacity and
  filters are all code.

## 18. Build sequence

Before anything else: `git init` and commit v1 as it stands, so there's a way back. The folder
isn't a git repo today.

| # | Block | Est. | Done when |
|---|---|---|---|
| 0 | Baseline. Fix the clipped chat box. Run the v1 hand check on Anthropic and write the numbers into `NOTE.md`. Make one OpenAI call from the deployed site (D2). Render the rupee test string in the candidate fonts. | 1h | The text box is visible on both chat screens at 1440 x 900. Three facts are written down: v1's cell counts, whether OpenAI answers a browser call, which font has ₹ |
| 1 | Model layer: `llm/` adapters, key slots, model list, connect row, settings | 2.5h | The packaging flow runs start to finish on each provider, picked in the UI |
| 2 | Rules and doubts: basis and check fields, rule cards, the last-year check, undo, D5, analyst counts | 2h | Packaging self-test shows 0 amber cells and 6 rules. A planted misread still turns amber. A confirmation can be undone. |
| 3 | Results screen: verdict strip, vendor rows, three tabs, grouped grid, docked source panel | 3h | Above the fold at 1440 x 900 you can read who replied, who cleared the gate, and what to confirm |
| 4 | Analyst: `answer` tool, answer card, cut-down award card, scenario tray, chart rules | 2.5h | The VP question returns a headline, at most 3 points and one card. Three scenarios sit side by side. |
| 5 | Flow: home, keyless browsing, run screen, stepper, empty states | 2.5h | From a saved key, one click reaches results. Without a key, the RFx and raw files open. |
| 6 | Visual system: tokens, type, states, focus, keyboard path, detector pass | 2h | First-run path works by keyboard. No text under 12 px. Detector findings fixed or listed. |
| 7 | Engine changes 1 to 10 | 3h | Packaging self-test numbers match block 0. Each new option has a self-test case. |
| 8 | IT hardware dataset and files | 3h | Five files open and look real. Self-test passes. The exact-match question changes the award. |
| 9 | Freight dataset and files | 3h | Five files open and look real. Self-test passes. The capacity question changes the award. |
| 10 | Hand checks for 3 datasets on each provider, cold run on the hosted URL, `NOTE.md` and README | 2h | A fresh browser with a fresh key finishes each dataset. Measured numbers are in the note. |

Total is about 26.5 hours (1 + 2.5 + 2 + 3 + 2.5 + 2.5 + 2 + 3 + 3 + 3 + 2). That's roughly three
working days, not one.

**Two halves that stand alone.** Blocks 0 to 6 (15.5 hours) are the usability and model work on
the existing dataset. Blocks 7 to 10 (11 hours) are the datasets. Stop after block 6 and the
demo is already easier to use.

**If time runs short, drop in this order:** second read (15.5), scenario tray, phone
layout, price tiers (change 6), freight dataset. Keep the model layer, rules and doubts, the
verdict strip and the answer card to the end.

## 19. Rules for Part 2

Part 1's rules stand. These are added:

- **The key goes only to the provider the user picked**, or through the stateless relay if D2
  needs one, and the screen says which.
- **Unconfirmed is still counted.** Fewer amber cells must not mean fewer warnings in totals. Any
  total that uses a price under an unaccepted rule or an open doubt says so, with the count.
- **A what-if is labelled as a what-if** wherever its number appears, including exports.
- **No dataset ships an answer.** Questions only, in `index.json`.
- **Measured numbers are per dataset and per provider.** A blank is better than a guess.
- **Design polish is in scope now.** Part 1 said rough is fine. For Part 2, section 14 is the bar.

## 20. Risks

| Risk | Handling |
|---|---|
| OpenAI can't be called from the browser | Tested first, in block 0. Relay fallback and its copy changes are in 15.3. |
| Hiding amber hides a real error | The last-year check in 12.1, the outlier check, and the hand check's "wrong and not flagged" count, compared before and after block 2. If that count rises, D1 goes back to v1 behaviour. |
| The `answer` tool makes the analyst terse to the point of dropping a caveat | Caveats have their own field and the tool results still carry them. Check the six demo questions by eye on both providers. |
| Engine changes break packaging | Self-test after every step in section 17, against block 0's numbers. |
| A provider reads a photo much worse than the other | Expected. It's reported, not hidden. The second read (15.5) turns it into a feature. |
| Three datasets triple the hand-check work | It's budgeted in block 10. If it slips, ship the datasets that were checked and mark the rest "not yet measured" in the UI and the note. |
| Schema grows past a provider's limits | Lists instead of nullable fields. Confirm both providers' limits before block 7. |
| Scope: 26.5 hours against an unknown deadline | The two-halves split and the drop order in section 18. |

## 21. Docs to update when Part 2 is built

- `NOTE.md`: the calls made (rules against doubts, open model layer, three datasets), measured
  numbers per dataset and provider, and the left-out list updated (the review queue by rupee
  impact is no longer left out).
- `README.md`: providers, the relay if one exists, `--dataset` on the scripts, the new file map.
- `CLAUDE.md`: already points here.
- Section 7's demo questions: add two per new dataset, including the one each can't answer.

---

# Part 3: make it look designed, and add MRO spares

Written 2026-10-10 after Part 2 was built (commits `1eb8c8b` to `01c76e9`). The reviewer's reaction to
the build: "I am not happy with the design." He confirmed the five defaults in section 10 and
asked for MRO spares as a full dataset. Where Part 3 and Part 2 disagree, Part 3 wins. Section 14
is replaced by section 23.

**The spec is a file you can open, not only this text: `design/mock.html`.** Open it in a browser
before writing any code. It has four screens (Home, Results review, Results prices, Ask) and the
review screen works: J and K move, A accepts, and the vendor totals change state. Part 2 came out
generic because its design section was prose. Build to the mock. Where the mock and this text
disagree, ask.

What the mock is and isn't:
- Its numbers on Results, Prices and the scenario card are the packaging dataset's computed
  values from a perfect read (seeded from the answer key by `scripts/_shots.mjs`, and from
  `awardScenario`). A live run shows more doubts.
- The quote text inside its evidence slips is put together from each cell's raw text and unit. It
  is not copied from the vendor files. The app shows the real quote.
- The analyst's wording and the three follow-up chips are placeholders and say so on screen.
- Its inline icons are there to keep the file standalone. The app keeps the icon set in `ui.tsx`.
- It is a design reference only. Nothing in `src/` imports it and it is not deployed.

## 22. Why Part 2 still reads as undesigned

Found by the designer-reviewer sub-agent (one pass, read-only, with the Emil Kowalski, Impeccable
and taste skills loaded) and by looking at screenshots of all three datasets at 1440 x 900. "Seen"
means visible in a screenshot. "Code" means read in the source and not run.

1. **Everything has the same weight.** Seen. The verdict, a vendor name, a ₹4 crore total and a
   footnote are all 13px medium or semibold in a white box with a 1px slate border. Code: 74 uses
   of `text-xs`, 6 of `text-lg`. The biggest text in the product is a sentence on Home.
2. **Money is drawn as body text, and one column mixes lakh and crore.** Seen on Prices: ₹83.53
   lakh sits above ₹2.26 crore, so the bigger-looking number is the smaller amount. Code:
   `inrShort` in `lib/normalize.ts` picks the unit per value.
3. **Amber is spent again.** Seen on Results: 15 amber marks above the fold, with "provisional" on
   all five vendor rows. When every row carries it, it says nothing.
4. **The same vendor facts are drawn three times.** Seen: in the summary table, again in "Know
   before you award", again in the grid header and footer.
5. **The evidence is the weakest drawing in the product.** Seen: a 12px quote in a grey box, a
   numbered list, then a third of the panel empty. Code: `font-mono` is used but no mono font is
   installed, so quotes render in whatever the OS has.
6. **The Prices tab opens on four rows and blank space.** Seen. The 30 x 5 grid the assignment is
   named after sits behind a "Show all lines" checkbox.
7. **Home is three equal text cards,** about 14 lines of 13px each, with three identical primary
   buttons. A fourth dataset makes it worse.
8. **The Results header has two primaries** ("Next: ask the analyst" and "Review 6") and a stepper
   with numbered circles, chevrons, checks, a count and a pill in 400px. It looks like a wizard.
9. **Accept, the review screen's whole job, is an outline button,** and the rupees at stake, which
   is the sort key, is grey text at the bottom of each card.
10. **Shape and token drift.** Code: four radii with no rule, raw hex in the charts
    (`AskView.tsx`), `bg-amber-200` for `mark`, a native checkbox and select in the grid toolbar.

What Part 2 got right and Part 3 keeps: status is always a word, never colour alone. The docked
panel instead of an overlay. The keyboard model. 32px rows and tabular numerals. Like-for-like on
shared lines with the count stated. "A computed scenario, not an award." Undo on every decision.
Plain-word copy. The rules-and-doubts model in section 12.1 does not change.

## 23. The design system (replaces section 14)

One idea runs through all of it: **the page is nearly monochrome, and colour appears only where
the buyer has to do something.** Tokens, with exact values, are in the `:root` block of
`design/mock.html`. Copy them into `@theme` in `src/index.css`.

**Type.** Keep Geist Variable. Add `@fontsource-variable/geist-mono`. One rule for mono: sans is
what we say, mono is what the vendor wrote (quoted text, the figure as written) and line ids.
Computed money is never mono.

| Size / line | Weight | Job |
|---|---|---|
| 12 / 16 | 400, or 500 for a group label | Labels, column heads, units, captions |
| 13 / 20 | 400 | Body and grid cells |
| 15 / 22 | 600 | Vendor totals in the grid header, event names, question text |
| 18 / 24 | 600 | The title of the thing selected (a rule, a cell) |
| 22 / 28 | 600, tracking -0.02em | One statement per screen: the verdict, the answer headline |
| 28 / 34 | 600, tracking -0.025em | Home only: the selected event's name |

Weight 500 is for things you click and for names. 600 is for titles and totals. Nothing else is
bold. Tabular numerals everywhere (`font-variant-numeric` on `body`).

**Money.** One component, used everywhere a rupee amount is a result:
- Figure at weight 600. The unit word ("crore", "lakh") follows at weight 400 in `ink-3`.
- **One unit per column.** A column of totals is all crore or all lakh, never mixed. Change
  `inrShort` to take the unit from its caller. Per-piece prices keep two decimals.
- **Pencil and ink. This is the signature.** A figure that rests on a rule the buyer has not
  accepted, or on an open doubt, is drawn in `ink-2` with a dotted underline in the `need` colour.
  When the last thing it rests on is confirmed, it turns solid ink (the mock's `.money.open` and
  `.inked`). This replaces every "provisional" pill. It applies to grid cells, vendor totals,
  scenario totals and the tray. Unconfirmed is still counted in words wherever a total is used
  (section 19 stands).

**Colour.** One cool neutral family (`ink`, `ink-2`, `ink-3`, `line`, `line-2`, `surface`,
`canvas`, `sunk`). Then four colours, one job each, never decoration:

| Token | Job | Where |
|---|---|---|
| `ink` | Actions | Primary buttons are near-black. Links are ink with an underline. No blue buttons. |
| `need` (burnt orange) | Needs your yes | The count, the queue mark, the dotted underline, "uses 19 unconfirmed prices" |
| `stop` (red) | Cannot be used | Failed gate. Nothing else. |
| `done` (green) | You cleared it | The queue mark after Accept, the word "Accepted" |
| `trace` (ink blue) | Traced to the vendor's file | The highlight inside a quote, the selected cell's ring, the highlight in the document view |

`mark` changes from amber to `trace-soft`, so a highlight stops looking like a warning. Charts use
ink and `ink-3` only, with labels in text colour.

**Surfaces.** A white card on the grey canvas is allowed for exactly two things: the working
surface of a screen (the queue and detail, the grid) and a scenario. Everything else is separated
by a hairline or by space. No nested cards. No coloured side stripes. Radius: 6px on controls,
10px on those containers, 3px on format tags. Nothing else.

**One primary per screen.** Home: "Read all five and compare". Review: Accept. Prices: none
(Export is quiet). Ask: Ask. The header has no buttons except the model chip.

**Header.** 48px. Wordmark, the event name, then four plain text tabs (RFx, Replies, Results,
Ask) with the current one on a sunk fill and one orange count on Results. No circles, chevrons or
checks.

**Reviewer's suggestions not taken, so you know they were weighed:** radius 0 on containers (the
mock uses 10px and keeps it), and merging the verdict into the grid's header on the review tab
(the review tab keeps a separate verdict, see 24.3; the Prices tab does take the idea).

## 24. Screen by screen

### 24.1 Home

Two panes, as in the mock. Left, 400px: sourcing events as rows (name, buyer, kind, value). Right:
the selected event. Its name at 28px, one sentence, the primary button, then the five reply files
as five tiles (format tag, vendor, what is awkward about it). A tile opens that file. Below, the
questions the event can answer, as a plain list. Selecting a row swaps the right pane with no
animation.

This scales to four datasets and replaces the three equal cards. Cut: the 20px marketing sentence,
the "No model connected" banner (the header says it once), the per-card buttons.

### 24.2 Reading (the run screen)

Make it Results loading, not a separate screen. Show the Results layout from the start with the
vendor table in place. Each vendor row shows its file's state (waiting, reading with seconds
ticking, read, failed) where its standing and total will be, with a skeleton in the final shape.
As each file lands, that row fills in. When the last one lands, the verdict sentence appears in
place and the tabs appear below. No jump to another screen (`RunScreen.tsx` navigates away today).

### 24.3 Results: review (the "To confirm" tab)

**Verdict band.** Left: one computed sentence at 22px, then one line with the count. Right: the
vendor table. Its rows are sorted with awardable vendors first. Columns: name, standing in words
(gate, freight, lines), a dot on a shared rupee axis, the like-for-like total as pencil or ink.

- The dot lane is why the band earns its space. Five totals between ₹3.47 and ₹3.69 crore are
  unreadable as five numbers. On one axis the story is visible: the three lowest are hollow.
  Filled dot means can be awarded, hollow means not yet. A dashed line marks last year. The axis
  is not zero-based, which is fine for position marks, and its two ends are labelled.
- The sentence is picked by code from a small set of templates, never written by the model. In
  priority order: (a) the N lowest totals are from vendors who can't be awarded, (b) no vendor
  cleared the gate, (c) no vendor priced every line, (d) otherwise the count sentence Part 2 has.
- "Know before you award" and its "Noted" buttons go. Those facts are the Standing column, and
  they appear in the queue's second group.

**Queue and detail.** One container, two panes. Left: the queue as single rows in two groups,
"Conversions to accept, largest first" and "Stops an award, nothing to accept". Each row: a small
square mark, what it is, vendor and line count, rupees at stake right-aligned. Right: the selected
item. Vendor, title at 18px, one or two sentences, the rupees and line count at 22px, **the
vendor's own words** as an evidence slip (format tag, file name, the quote in mono with the
figure highlighted in `trace`), "How code worked it out" as rows of *as written → result*, then
the actions pinned at the bottom: the ink Accept button named for what it covers ("Accept for 30
lines"), "Open the file", "It's wrong".

- Evidence sits beside the decision. Nobody opens a panel to see why. Opening the whole file
  still uses the docked panel from Part 2.
- Accepting keeps the row in place, greys it and turns its mark into a green dot, moves selection
  to the next open row, and inks in every figure that no longer rests on anything open. The pane
  then shows "Accepted" and Undo.
- Open doubts (a live run has them, a perfect read doesn't) are a third group at the top of the
  queue, "Check by eye", and their detail pane shows the cell's quote, the reader's note, and
  Correct it / It's right.
- Keys: J and K move, A accepts, O opens the file, U undoes. Shown once, at the right of the tab
  bar.

### 24.4 Results: prices

The grid is the page. No verdict band on this tab, since the band's content moves into the grid's
header: each vendor column head carries the name, the like-for-like total (pencil or ink) and
standing in one or two words. The left head carries "27 shared lines, a year" and last year's
total. The footer total row goes.

- All groups open by default, one scroller (remove the `max-h` on the grid and let the page
  scroll, with the header row sticky). The "Show all lines" checkbox goes.
- A vendor who can't be awarded gets a `canvas` column fill and `ink-3` figures. That is how the
  eye learns to skip three columns.
- Lowest awardable price on a line: weight 600 with a 2px ink underline. No dot.
- Conversion marks sit in a fixed gutter left of the figure, in mono 11px `ink-3`: `÷100`, `USD`,
  `per kg`, `÷25`, `LY`, `-4%`. Spell the word where it fits ("per kg", "USD"), no bare "$".
- The legend is one line of three live samples at the right of the tab bar, as in the mock.
- Filters (All, Flagged, Missing, Converted) become the same segmented control as the tabs, one
  size smaller. Replace the native select for "Show" with it too.
- Group rows show subtotals in one unit for the whole column.

### 24.5 The source panel

Opened from a grid cell or from "Open the file". Same vocabulary as the review detail pane: the
price at 22px with its unit, the evidence slip, the as written → result rows, the rules behind
it, then the document inline with the `trace` highlight scrolled into view (not collapsed behind
"Show the whole document"). Correct-it stays pinned at the bottom. When the cell isn't on the
review walk, hide the "n of 9" counter instead of showing a dash.

### 24.6 Ask

- The question is quiet (15px `ink-2` with a hairline at the left), not a chat bubble. The answer
  is the loud thing: headline at 22px, points at 15px.
- One scenario card under the points: name, "computed scenario, not an award", the total as
  pencil or ink at 22px, a share bar only when two or more vendors are in it (ink, then `ink-3`),
  each vendor's rupees, lines and share in text under the bar, and one `need` line saying how many
  unconfirmed prices it uses with a "Review them" link. The figure appears once in the card.
- The caveat is one plain sentence with a 1px `need` rule at its left.
- The tray becomes a comparison table: one column per scenario, rows for total, against last
  year, vendors, lines covered, unconfirmed prices. This is what "side by side" should mean.
- Suggested questions wrap to two lines instead of clipping. The composer is one line that grows,
  with the ink Ask button inside it.

## 25. MRO spares: the fourth dataset

`mro-spares`. Buyer: a mid-size plant, annual rate contract for maintenance spares. 30 lines of
long-tail items (bearings, V-belts, oil seals, filters, contactors, limit switches, hydraulic
hose assemblies, gloves and consumables), each with a part number, a brand asked for, a yearly
quantity and last year's price.

What makes it different from the other three, and so what new questions it opens:

| Awkwardness | What it tests | Engine need |
|---|---|---|
| No vendor quotes more than about 18 of 30 lines, and the sets overlap unevenly | Coverage. "Fewest vendors that cover everything." | `award_scenario` with `max_vendors` already exists. Check it picks a covering set, not only a cheapest set. |
| OEM part against "equivalent" brand on the same line | Match quality, already in the engine from IT hardware | `exact_match_only`, built in Part 2 |
| Minimum order quantity above the yearly need on some lines | Hidden cost. "What do the minimums cost us?" | New: an optional `moq` per quoted item. Line cost uses `max(quantity, moq)` and the cell shows a `MOQ` mark. Flagged as a rule to accept, like a conversion. |
| Prices per pack (box of 10, set of 2, per metre for hose) | Unit conversion, already built | `per_n_units`, `per_measure` |
| Lead time varies from ex-stock to 10 weeks | A gate on something other than quality | A questionnaire answer per vendor plus an optional per-line lead time attribute. "What changes if everything has to arrive in 3 weeks?" reuses the IT hardware option. |

Five replies, five shapes, different from the earlier sets where it's cheap to do so: a
distributor's Excel price list with their own part codes and an MOQ column, a PDF quotation with
"or equivalent" brands and lead times in a remarks column, a Word offer priced per pack, a photo
of a handwritten counter quote for about 12 lines, and a short email saying "all SKF bearings at
list less 32%, others as attached last month" (a reference the reader must record and code must
not guess).

Home card questions (questions only, no answers, per section 16.4): "What is the smallest set of
vendors that covers all 30 lines?", "What do the minimum order quantities cost us in the first
year?", "Which lines only have an equivalent, not the brand we asked for?". The one it can't
answer: "Which equivalent brands has maintenance approved?" (no approved-brand list was asked
for).

Files follow section 16.4: `scripts/datasets/mro-spares.mjs`, `scripts/truth/mro-spares.json`,
`public/samples/mro-spares/`, one entry in `public/samples/index.json`. The answer key never
reaches the app.

## 26. Motion and interaction

From reading the code, not from running it. Fix these as you touch each file.

| Before | After | Why |
|---|---|---|
| Button has `transition-colors` only (`ui.tsx`) | Add `active:scale-[0.97]` with `transition: transform 140ms`, colours 120ms | A press should feel heard |
| Source panel plays the `.slide-in` keyframe and is re-keyed per cell (`Results.tsx`), so it likely replays on every arrow key | Mount once per open. Swap content instantly while it's open | Never animate a keyboard action |
| Panel focuses itself on every mount (`SourcePanel.tsx`) | Focus it only when opened by click or Enter. Arrow keys keep focus in the grid | Grid walking likely breaks after one step today |
| `@keyframes slide-in` 180ms | A transition with `@starting-style`: opacity and `translateX(16px)`, 200ms, `cubic-bezier(0.23, 1, 0.32, 1)`. No exit animation | Transitions can be interrupted. Esc should be instant |
| Accept removes the card at once (`ToConfirm.tsx`) | Row stays and greys, mark turns green over 200ms, the figures it frees ink in (the mock's 420ms opacity and 1.5px blur), selection moves to the next open row | The one authored moment in the product: confirming visibly firms up numbers |
| `transition-colors` on about 150 grid cells | No transition on cell hover | Hover trails lag when scanning a dense grid |
| Filter and open-group state lives inside the Prices tab | Lift it to Results | Likely lost on every tab change today |
| Spinner plus a pulsing bar on the run screen | Skeleton in the final row shape. Each result fades in over 200ms. Seconds tick in tabular numerals | The loader should match what lands |
| `.flash` 1.6s | 700ms | Too long for a work tool |
| Reduced motion sets every animation to 0.01ms | Remove movement only. Keep colour fades and the spinner | Reduced means gentler, not broken |
| Export menu is a native `details` | Popover API, scale 0.97 to 1 with opacity, 125ms, origin top right, closes on outside click | A popover should grow from its trigger |
| Tabs swap instantly | Keep it | Right as it is |

Also theme the parts the browser draws: text selection (ink background, white text, as in the
mock), the caret, the focus ring in ink not blue, and scrollbars left native.

## 27. Build sequence for Part 3

Commit after each block. Run the packaging self-test after blocks 1, 3 and 6. Take screenshots
with `scripts/_shots.mjs` after blocks 2 to 5 and compare them with the mock side by side.

| # | Block | Est. |
|---|---|---|
| 1 | Tokens from the mock into `@theme`. Geist Mono. The Money component with pencil and ink and one unit per column. Button ranks. Header. Remove every "provisional" pill and every blue button | 2h |
| 2 | Results review: verdict templates, vendor table with the dot lane, queue and detail panes, evidence slip, accept and undo behaviour | 4h |
| 3 | Prices: totals into the header, groups open, one scroller, column fill for vendors who can't be awarded, gutter marks, lowest marker, legend, segmented filters | 3h |
| 4 | Source panel in the same vocabulary, document inline. Reading state folded into Results | 2.5h |
| 5 | Home as list and preview. Ask: answer type, scenario card, comparison tray, composer | 3h |
| 6 | MRO spares: dataset definition, five files, answer key, `moq` in the schema and the engine, home entry, self-test, hand check | 4h |
| 7 | Motion table in section 26, browser surfaces, a pass at 1280 and 1440 wide, docs in section 21 plus the MRO questions | 2h |

About 20.5 hours. This is a reasoned estimate, not a measured result. Blocks 1 to 5 (14.5h) are
the redesign and stand alone. Block 6 is independent of them and can go first or last.

**If time runs short, drop in this order:** the reading state folded into Results (keep the
current run screen, restyled), the comparison tray, the Popover export menu.

**Built 2026-10-10,** all seven blocks, nothing dropped from the drop list. Where the build differs
from the mock is listed in `NOTE.md` under "Where the build differs from the design mock". Two
engine additions the plan did not spell out: the minimum order travels in the reading's `details`
list as kind `min_order` (to keep the schema small), and `award_scenario` has a `fewest_vendors`
option for the coverage question. Not done: any live model run, and an independent design review.

**Done means:** the four mock screens and the built screens look like the same product side by
side; no figure on any screen is drawn without the Money component; the only blue on screen is a
quote highlight or a selected cell; and the hand-check numbers in `NOTE.md` are filled for all
four datasets or say "not yet measured".

---

# Part 4: the decision view, in frosted graphite

The reviewer rejected the Part 3 look on 2026-10-10 ("still just a white screen on black"), then
rejected three recoloured versions of the same layout (`design/directions.html`, kept only as a
record). What he approved is `design/vp-dark-colour.html`. **Open it in a browser before writing
any code. It is the design spec for Part 4.** Click Confirm on both red tiles and watch what
changes. `design/vp.html` (light) and `design/vp-dark.html` (no colour) are earlier steps, not
the spec.

Where Part 4 and Part 3 disagree, Part 4 wins. Sections 23 and 24.3 are replaced. The engine,
the datasets, the provider layer and every rule in `CLAUDE.md` stay as they are.

What the mock is and isn't:

- It draws one screen, Decide, at 1440 and 390 wide. Compare and Ask are not drawn. Section 31
  says how to carry the look over to them.
- Its numbers are the real computed packaging values from a perfect read. A live run shows more
  doubts.
- The quote text in the proof box is assembled from each cell's raw text, not copied from the
  vendor files. The app must show the real quote, as it does today.
- The Compare, Ask, "Show them" and "Compare the two" controls in the mock do nothing.

## 28. Why this replaces Part 3

His brief, in his words: look at it "through the lens of a senior VP using it to make
decisions", "not overloaded with information", "clean, simple, and sort of elegant", "an Apple
frosted glass sort of a thing", then "slightly darker, not black, like frosted black".

The Part 3 screen asked the reader to do the work: five vendors on an axis, six conversions in a
queue, a detail pane, three tabs. A VP wants the answer, who it rests on, and what is left for
them to do. So Part 4 changes what the first screen says, not only how it looks:

1. **One answer first.** The lowest award that can be made today, computed by code.
2. **Only the confirmations that change that answer.** Packaging has six open conversions. Two
   sit on vendors who can be awarded. The other four go behind one link.
3. **Colour means something.** Frosted red is "act now". Frosted green is "done" or "good".
   White is the headline and the money. Everything else is a quiet blue-grey.
4. **Proof on demand.** The vendor's words and the arithmetic open in place, one click away.

## 29. The design system (replaces section 23)

Take every value from the `:root` block of `design/vp-dark-colour.html` and put it in `@theme`
in `src/index.css`. Components use token names, never raw hex.

**Ground and glass**

- Ground is graphite `#1c1d22`, never black, with three large soft blooms (blue top left,
  violet top right, green bottom) fixed behind the page. The blooms are what the glass blurs.
  Keep them as quiet as the mock.
- A card is glass: `rgba(58,60,68,.46)`, `backdrop-filter: blur(40px) saturate(150%)`, a 1px
  light edge, a bright inner top line and a deep soft shadow. Radius 22px on cards, 16px on
  tiles inside a card, pills for buttons.
- Never put one neutral glass card inside another. Inside a card use a coloured tile, a hairline
  or space.
- `prefers-reduced-transparency` and `prefers-contrast: more` switch glass to a solid surface.
  `prefers-reduced-motion` removes transitions. All three are in the mock.

**Colour, one job each**

| Token | Job |
|---|---|
| `--ink` `#f5f6fa` | Headline, money, the names of vendors you can award |
| `--ink-2` `#b8c1d6`, `--ink-3` `#8791a8` | Supporting text and labels. Cool blue-grey, not grey-white |
| `--red-glass` + `--red-line` | A tile or strip that needs the buyer now |
| `--green-glass` + `--green-line` | The same tile or strip once it is done |
| `--stop` `#ff8279` | Red text on neutral glass only: a panel title that needs action, "Can't award yet", a blocked vendor's reason |
| `--ok` `#5fd08a` | Green text on neutral glass only: good news in the headline, "Can award", a cleared reason, a saving |
| `--accent` `#3d9bff` | Links, the selected tab's focus ring, the award split bar. Not for status |

**The rule he asked for twice:** text inside a red or green tile is white (`#fff`, supporting
line at 82% white), never a shade of the tile. The button inside a tile is a white pill with
dark text. Red and green text live only on neutral glass.

Red glass is for things the buyer can clear with a click. A vendor who can't be awarded gets red
text and a dimmed name, not a red tile.

**Type**

- Face: the system stack in the mock (`-apple-system, ... system-ui`), then Geist Variable as
  the fallback so Windows does not fall to Arial. Mono stays Geist Mono, used only for the
  vendor's words and the arithmetic.
- Sizes step down inside every panel and never skip back up:

| Level | Example | Size |
|---|---|---|
| Product name | "Quote desk" | 40px, 600, silver |
| Page headline | "Two of five vendors can be awarded today." | 46px, 600, tracking -0.026em |
| Hero figure | "₹3.98" | 68px, 600, unit at 26px in `--ink-3` |
| Panel title | "Vendors", "2 things to confirm before this is firm" | 22px, 600 |
| Group | "Can award", "Can't award yet" | 17px, 600, coloured, with a dot |
| Row | a vendor name, a tile title | 15px to 17px |
| Detail | a reason, a caption | 13px |

  A group label is always bigger than the rows under it. This was a specific correction.
- Tabular figures on every number. One unit per column still holds.

**The product name.** "Quote desk" sits alone and centred above the toolbar in brushed silver:
a vertical gradient clipped to the text (white, a darker band just under the middle, light
again) with a soft drop shadow. Copy the `.brand` rule from the mock, including the
`forced-colors` fallback. This is the only gradient text in the product.

**Toolbar.** One floating glass bar, sticky, 54px, radius 18px: event picker on the left, a
segmented control in the exact centre (Decide, Compare, Ask), model status on the right.

**Pencil and ink is retired as a text style.** "Not firm yet" is now said once, by the red
strip under the award, and each unconfirmed thing is a red tile. No dotted underlines.

## 30. Decide: the first screen of Results

Decide replaces the "To confirm" tab and the verdict band. It is what Results opens on. Every
number on it comes from code that already exists.

**30.1 Headline.** One sentence from the count of vendors with `gate === 'pass'`:

| Awardable | Headline | Line under it |
|---|---|---|
| 2 or more of N | "{n} of {N} vendors can be awarded today." | Why the others can't, in one or two short sentences |
| 1 of N | "One of {N} vendors can be awarded today." | Same |
| 0 | "No vendor can be awarded yet." | What blocks each, shortest first |

The count is green. If the cheapest replies are among the blocked ones, say so in red, as the
mock does ("three cheapest can't be used yet"). Build the second line from the same reasons the
vendor panel shows. No model call.

**30.2 Award card.** Call `awardScenario(grid, { eligible_vendors: 'passed_quality_gate' })`.

- Label: "Lowest award you can make, all {lines_awarded} lines, a year". If
  `lines_without_an_eligible_price` is not empty, the label says "{x} of {y} lines" and a line
  under the split names how many have no usable price.
- Figure: `total_display`. Under it `saving_vs_reference` as "₹x under last year" in green or
  "₹x over last year" in `--ink-2`.
- Split bar: one segment per entry in `vendors_in_award`, width by `share_pct`, each with name,
  lines and cost under it. One vendor means one full bar. More than three vendors: show the top
  three and "+n more".
- Status strip: red glass with "Not firm yet" and "{unconfirmed_prices_used} of {lines_awarded}
  prices rest on {n} conversion(s) you haven't confirmed." When nothing is left it turns green
  glass: "Firm" and "Every price in this award is confirmed against the vendor's file."
- Alternative, one quiet line from `best_single_eligible_vendor`: "One vendor instead: {name}
  at {cost}, {extra} more." The link opens Ask with that comparison asked.
- Zero awardable vendors: no figure. The card says what would have to change, and the confirm
  panel is replaced by the blockers.

The tool shows the lowest award that can be made. It never says "award this". The buyer decides.

**30.3 To confirm.** Open rules whose vendor is in `vendors_in_award`, largest money first.

- Each is a red glass tile: a plain title naming the vendor and what they did ("PackGlobal
  quoted in US dollars"), one line on what code did about it, a white Confirm pill.
- "See the vendor's words" opens the real quote and the arithmetic in place (grid rows 0fr to
  1fr, 320ms). The quote is the stored source quote with the highlight. Never fill it from
  anything else.
- Confirm turns the tile green with a tick and "Confirmed". Clicking again undoes it. The panel
  title counts down in red ("2 things to confirm before this is firm") and ends green ("Nothing
  left to confirm").
- A rule with a choice (the conditional discount) shows two pills: the default in white, the
  other as outline.
- Under the tiles, one quiet line: "{n} more conversions sit on vendors you can't award. Show
  them". It expands the rest as neutral rows, not red tiles.
- Keyboard: tiles are in tab order, Enter confirms. Keep J, K and A from Part 3 on this list.

**30.4 Vendors.** One panel, two groups, cheapest first inside each.

- "Can award" in green, "Can't award yet" in red, both 17px with a dot.
- Row: name, like-for-like total on the right, one reason under the name. Awardable rows are
  white with a green reason. Blocked rows are dimmed with a red reason.
- Title carries the basis on the right: "on the {n} lines all five quoted". Caption at the
  bottom: last year on the same lines.
- A row opens that vendor in Compare.

**30.5 Layout.** Two columns at 1040px and up: headline and award card on the left, confirm
panel then vendors on the right. One column below that, in this order: headline, award card,
confirm, vendors.

**30.6 While files are being read.** Decide shows the headline "Reading {n} of {N} replies",
each vendor row filling in as its file lands, and no award figure until all are read. Use
skeleton shapes that match the final layout.

## 31. The other screens in the same language

These are not drawn. Build them from the rules, screenshot them next to the Decide mock, and fix
what does not look like the same product.

- **Compare** holds the price grid and "Questionnaire and terms" from Part 3, switched by a
  small segmented control. The grid sits in one glass card. Cells stay plain text on the card.
  Columns for vendors who can't be awarded are dimmed, not hatched. Lowest price per line is
  white and 600. An unconfirmed cell gets a small red dot, a confirmed one nothing. The source
  panel is a glass sheet from the right with the vendor's words.
- **Ask** keeps Part 3's structure: quiet question, loud answer, one scenario card, comparison
  tray. The answer's figure uses the hero figure style at 44px. Caveats are a red glass strip.
  Recharts series use `--accent` and its lighter step, then `--ok`. Give the charts dark axes
  and gridlines from `--hair`.
- **Home** keeps list and preview. The list is one glass card, the preview a second. "Read all
  five and compare" is the one white pill on the page.
- **RFx, Replies, the key screen:** same ground, glass cards, toolbar and type scale. No layout
  change.

Navigation changes with this: the header's RFx, Replies, Results, Ask tabs become Decide,
Compare, Ask in the toolbar. RFx and Replies move behind the event picker ("Open the RFx",
"See the replies"), since the VP rarely needs them.

## 32. Motion

| Moment | What moves | Timing |
|---|---|---|
| Confirm a tile | Tile background and border cross from red to green | 360ms, `cubic-bezier(.23,1,.32,1)` |
| Last confirm | Status strip crosses to green in the same beat, panel title turns green | 360ms |
| Open the proof | Height via grid rows, content clipped | 320ms |
| Press any button | `scale(.96)` on press, not on release | 120ms |
| Switch Decide, Compare, Ask | The selected pill changes at once. No page slide | none |

Nothing else animates. Keyboard actions do not animate their own trigger.

## 33. Build sequence for Part 4

Commit after each block. Run `node scripts/handcheck.mjs --dataset all --selftest` after block
2. Screenshot after blocks 2 to 5 with `scripts/_shots.mjs` (update it for the new view names)
and compare with the mock side by side at 1440 and 390 wide.

| # | Block | Est. |
|---|---|---|
| 1 | Tokens into `@theme`, graphite ground with blooms, the glass card, type scale, silver product name, floating toolbar with Decide, Compare, Ask. Remove the Money pencil style | 2.5h |
| 2 | Decide: headline rules, award card from `awardScenario`, status strip, the zero and one vendor cases | 3h |
| 3 | Decide: confirm tiles with proof, undo, the "more conversions" expander, vendors panel, reading state, keyboard | 3h |
| 4 | Compare: grid and terms on glass, dimmed columns, red dot for unconfirmed, source sheet | 3h |
| 5 | Ask, Home, RFx, Replies and the key screen in the same language. Chart colours | 3h |
| 6 | All four datasets through Decide. Contrast check on every text and glass pair. The three accessibility media queries. Docs: `NOTE.md`, `README.md`, the differences list | 2h |

About 16.5 hours. This is a reasoned estimate, not a measured result.

**If time runs short, drop in this order:** the reading state on Decide (keep the Part 3 one,
restyled), the "more conversions" expander (link to Compare instead), the navigation move of
RFx and Replies (leave them as two extra toolbar items).

**Risks**

- Compare and Ask have no mock. If they come out looking like a different product, stop and ask
  for a mock before polishing.
- A 30 by 5 grid on dark glass can get hard to read. Check it at 1280 wide before moving on.
- The mock was checked in headless Chromium only. Check blur and the silver name in Safari.
- MRO spares awards by fewest vendors and IT hardware is a one-time buy. The award card's label
  and "a year" wording must come from the dataset, not be hardcoded.

**Built 2026-10-10,** all six blocks, nothing dropped from the drop list. Where the build differs
from the mock, and the contrast figures, are in `NOTE.md` under "Where the build differs from the
design mock". Not done: any live model run, a check in Safari, and a second reviewer. Compare and
Ask were built from section 31 with no mock, so look at them before calling the design settled.

**Done means:** Decide and the mock look like the same screen side by side on packaging; no
text inside a red or green tile is red or green; in every panel a label is larger than what sits
under it; every figure on Decide comes from `awardScenario` or the grid; all four datasets load
Decide without a hardcoded word; and the self-test still passes.

---

# Part 5: text colour and one type scale on every page

The reviewer looked at the Part 4 build on 2026-10-10 and found two things wrong outside Decide:

1. **Everything is white.** Decide has a colour hierarchy. Home, RFx, Replies, Compare and Ask
   are white and grey text on glass.
2. **Text sizes are inconsistent.** His example: the event name in the toolbar ("IT hardware
   refresh") is tiny. The product name is also missing on some pages, and page titles differ in
   size from page to page.

There are two spec files, and between them every page is drawn. **Open both in a browser before
writing any code.**

- `design/pages-dark.html`: keys 1 to 9 and 0 switch Home, RFx, Replies, Compare, Ask, the key
  screen, Questionnaire and terms, the source sheet, the reading state, and a sheet of empty and
  error states.
- `design/vp-dark-colour.html`: Decide. It was updated on 2026-10-10 for Part 5 (bigger toolbar
  name, a back button, gold on the small amounts). The layout and the red and green are as
  approved.

Where Part 5 and Part 4 disagree, Part 5 wins.

What the mocks are and aren't: the numbers on Compare and Ask are the real computed packaging
values from a perfect read. The analyst's sentences on Ask are placeholder wording and say so on
screen. Compare shows 8 of 30 lines, RFx shows 6 of 30, and Questionnaire and terms shows 6 of
the 8 questions. The questions, answers and terms on that page are the real packaging data. The
states page is a sheet of six examples side by side, not a screen in the app. Error wording is
the app's own; keep whatever the provider layer returns.

This is a styling pass. No engine, dataset or behaviour change.

## 34. A colour for each kind of thing

Red and green keep their Part 4 jobs (act now, done or good). Part 5 adds three quiet text
colours, each taken from one of the three blooms behind the glass, so they sit in the same
family. Add them to `@theme` and use the token names.

| Token | Value | What wears it |
|---|---|---|
| `--ink` | `#f5f6fa` | Page titles and the names of things: an event, a vendor, a line's description, a question |
| `--ink-2` | `#b8c1d6` | Sentences: ledes, descriptions, explanations |
| `--ink-3` | `#8791a8` | Captions, column heads, units, footnotes |
| `--sky` | `#9cc7ff` | Section headings inside a card ("The five replies", "30 line items", "Terms"), categories in a table, the "Quality gate" tag |
| `--gold` | `#e8d3a0` | Money that is not the hero: an event's size, last PO, a price in a list or grid, a figure inside a sentence |
| `--lilac` | `#c5b8f7` | Codes and files: line ids, question ids, the RFQ number, file-type tags. File names use `--lilac-2` `#9d93cc` |
| `--accent` | `#3d9bff` | Links only |

Rules:

- One colour per kind of thing, everywhere. A line id is lilac on RFx, in Compare and in a
  source sheet. Money is gold in a list and in a grid.
- The hero figure on Decide and the two awardable vendors' totals stay white. They are the
  only money that is not gold.
- A card's own title (the left panel on Home and RFx) is white. Section headings inside the
  main card are sky.
- Coloured text never sits on red or green glass. That rule from section 29 still holds.
- No new colour for decoration. If a piece of text is not a name, a sentence, a caption, a
  section heading, money, a code or a link, it is `--ink-2`.

On Compare, as drawn: prices are gold, the lowest awardable price per line is white and 600, a
red dot follows a price that is not confirmed, line ids are lilac, group rows are sky, and a
vendor who can't be awarded has a dimmed name, total and column. On Ask, as drawn: the answer's
headline is white with its figures in gold and a saving in green, the caveat is a red glass
strip with white text, and the scenario card's heading is sky.

On Questionnaire and terms, as drawn: question ids are lilac, a gate answer leads with a green
"Meets it" or a red "Does not meet it" and then the vendor's own answer clamped to two lines in
`--ink-2`, a non-gate answer is plain white text, "Not sent" and "Not stated" are grey, and
freight is a green "Included" or a red "Extra". In the source sheet, as drawn: line id and file
name are lilac, the price is gold at 40px, the vendor's words are mono, and the unconfirmed
state is a red glass tile with white text.

## 35. One type scale, every page

Replace the mixed sizes with these seven. Put them in `@theme` as the only text sizes and remove
any arbitrary `text-[..]` values from components.

| Level | Size / line | Weight | Where |
|---|---|---|---|
| Product name | 40 / 46 | 600, silver | "Quote desk", centred above the toolbar on **every** page |
| Page title | 40 / 44 | 600 | One per page. Decide keeps its 46px headline as the one exception |
| Lede | 19 / 28 | 400 | The sentence under a page title |
| Section | 22 / 28 | 600 | Card titles and section headings |
| Name | 17 / 24 | 600 | Event name in the toolbar, event rows, vendor names, group labels |
| Body | 15 or 16 / 22 | 400 or 500 | Rows, table cells, questions, descriptions, buttons |
| Caption | 13 / 19 | 400 or 500 | Column heads, units, footnotes, file names |

- Nothing below 13px except the 11px mono file-type tag.
- **The event name in the toolbar is 17px, 600, white.** It was 14px grey. This is the fix he
  asked for by name.
- Toolbar is 58px tall. Decide, Compare, Ask are 15px.
- Inside any card the order is title, then section, then name, then body, then caption. A label
  is never smaller than what sits under it.
- Primary and secondary buttons are 40px tall with 15px text. Row buttons are 34px with 14px.

## 36. Page by page

Build each page to the mock, then screenshot it next to the mock at 1440 and 390 wide.

- **Every page:** the silver product name sits above the toolbar and scrolls away with the
  page. The toolbar stays sticky.
- **Home:** left card "Sourcing events" (white, 22px). Each row: name 17px white, size in gold
  17px, context and period in 13px grey. Right card: context line, title 40px, lede with the
  figure in gold, one white pill, sky section headings, lilac file tags, questions at 16px
  white with a chevron.
- **RFx:** RFQ number in lilac mono, title 40px, lede 19px. Table: lilac line ids, white
  descriptions, sky categories, white quantity with a grey unit, gold last PO. Question ids in
  lilac, "Quality gate" as a small sky pill after the question. Terms as a two-column list.
- **RFx terms labels are words, not field names.** The build shows `priceBasis` and
  `responseDue`. Show "Price basis", "Delivery", "Warranty", "Payment", "Replies due", and
  format the date as "24 October 2026".
- **Replies:** title 40px with the two buttons on its right. Each file: lilac tag, vendor name
  17px white, file name in lilac mono 13px, description 15px.
- **Compare:** context line, title 40px ("Every price, side by side"), lede, then a small
  segmented control and a three-item key on one row. Vendor header: name 17px, total in gold
  17px, a green or red status word 13px. The grid keeps its Part 4 structure.
- **Ask:** the question is quiet (17px `--ink-2` under a 13px "You asked"). The answer is one
  glass card: headline 30px, points 16px, the red strip, then "The two options" as a plain
  table, then follow-up chips. The composer is its own glass pill under the card.
- **Key screen:** one centred card, title 40px, lede, three labelled fields, one white pill,
  and the line saying where the key goes. Keep the app's current wording and behaviour; the
  mock's copy is shortened.
- **Questionnaire and terms** (the second half of Compare): one table, vendors across the top
  in award order (awardable first), three sky group rows: "Quality gate", "Other questions",
  "Commercial terms". A click on an answer opens the source sheet.
- **Source sheet:** a glass sheet fixed to the right edge, 460px, no scrim, so the grid stays
  readable beside it. Top to bottom: line id and size, vendor name 22px, the price, "The
  vendor's words", "How code worked it out" as label and value rows, then the confirm tile
  (white Confirm pill, outlined "It's wrong"), and "Open the file" pinned at the bottom. The
  clicked cell keeps a blue ring. Escape and the close button dismiss it along the same path.
- **Reading state** (Decide while files are read): headline counts progress with the done part
  in green, the award card is a skeleton with one line saying when it fills, and the vendors
  panel has two groups, "Read" in green and "Being read" in sky, each row moving up as its file
  lands. Skeleton shimmer stops under reduced motion.
- **Empty and error states,** six drawn. Empty states are one glass card with a 30px title, a
  lede and one white pill. An error the buyer can clear with a click (a file that failed to
  read) is a red glass tile with white text and a white "Try again" pill. An error in a field
  (a rejected key) is a red outline on the field and red text under it, on neutral glass. No
  toast and no modal for either.
- **Decide:** the toolbar event name goes to 17px with a back button, toolbar tabs to 15px, and
  money that is not the hero or an awardable total goes gold (the split amounts, "One vendor
  instead", last year). Blocked vendors' totals are a dimmed gold.

## 37. Build sequence for Part 5

| # | Block | Est. |
|---|---|---|
| 1 | Tokens: the three text colours, the seven sizes. Product name on every page. Toolbar event name and height | 1h |
| 2 | Home, RFx (with the terms labels), Replies to the mock | 2.5h |
| 3 | Compare with Questionnaire and terms, the source sheet, Ask, the key screen and the Decide changes, to the mocks | 3.5h |
| 4 | The reading state and the six empty and error states, to the mocks | 1.5h |
| 5 | Sweep: no `text-[..]` values left, nothing under 13px, screenshots of every page next to the mock at 1440 and 390, contrast check on gold, sky and lilac against glass | 1h |

About 9.5 hours. This is a reasoned estimate, not a measured result.

**Built 2026-10-11,** all five blocks. Where the build differs from the mocks, and the contrast
figures for gold, sky and lilac, are in `NOTE.md` under "Where the build differs from the design
mocks". Not done: any live model run, a check in Safari, and a second reviewer.

**Risk:** three more text colours can turn into the "sketch pen" look he rejected earlier. The
guard is the rule in section 34: one colour per kind of thing. If a page ends up with every
colour in one row, something is miscoloured.

**Done means:** on every page the product name is present and the toolbar event name is 17px;
every page title is the same size; no page is only white and grey; a line id, a rupee figure
and a section heading each have the same colour on every page where they appear; and every
drawn page and state matches its mock side by side.
