# Build plan: Kill the Quote Spreadsheet

Aerchain PM take-home. Brief: `brief/BRIEF.md` (transcribed from the screenshots beside it).
Plan written 2026-10-09. Nothing in this folder has been built or tested yet.

## 1. The bet

Everyone will ship a chat box over a comparison table. The brief says the happy path earns
nothing, and names three things it grades: ugly edges, trust, and judgment. So this build spends
most of its effort on one question:

**When the system isn't sure, what does it do, and what does the buyer see?**

Three rules follow from that. They are the architecture.

1. **The model reads. Code computes.** Claude extracts what the vendor wrote and maps it to RFx
   lines. Unit conversion, currency conversion, totals, rankings and award scenarios run in
   deterministic code. The analyst answers by calling tools, never by doing arithmetic in prose.
2. **Every number on screen traces to its source.** Click a cell, see the exact snippet, page, or
   image region it came from, plus every conversion applied to it.
3. **Unsure is a first-class state.** A cell is `confirmed`, `needs review`, or `missing`. Nothing
   gets filled in silently. Analyst answers say when they rest on unreviewed cells, and say
   whether the award would change if those cells were wrong.

Decision this prototype has to support: a category buyer picks an award (single vendor or split)
for a ₹4 crore packaging buy and can defend it to a VP.

## 2. Decisions locked (and why)

| Choice | Decision | Why |
|---|---|---|
| Category | Corrugated packaging, 30 SKUs | It's the brief's own example. The "₹42/kg for the 5-ply" email needs per-kg to per-piece conversion, which is a real ugly edge only this category gives for free. |
| Buyer persona | Category buyer at an Indian D2C/FMCG company, annual packaging contract | INR base currency, GST, freight terms all feel native. |
| Stack | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, one repo, runs with `npm run dev` | One process, fast to demo on a laptop. |
| Storage | SQLite via `better-sqlite3`, raw vendor files on disk | Zero setup. The analyst gets a read-only SQL tool over the same tables. |
| Models | Claude via the Anthropic TypeScript SDK. Vision and PDF input go straight to the model. | One vendor, native PDF and image reading. |
| Agent framework | None. A plain tool-use loop with a step budget. | Fewer moving parts to explain in a live demo. Nothing here branches enough to need more. |
| Email path | Stubbed. An in-app outbox and inbox. Replies arrive via a "simulate replies" control and a real file-upload drop zone. | The brief allows stubbing plumbing. The upload path is what lets reviewers throw their own file at it live. |
| Charts / exports | Recharts. Exports: XLSX comparison (ExcelJS) and a one-page award memo (HTML to PDF). | A buyer's VP wants a spreadsheet and a memo. |

**Assumption:** I am proceeding on the basis that the model IDs are `claude-opus-5-5` (extraction,
analyst) and `claude-haiku-5-5` (cheap verification passes). These come from this session's
environment, not from the live docs. If this is wrong, the builder swaps IDs in one config file.
Run `/claude-api` before writing any SDK code and take IDs, PDF/image input shapes and structured
output syntax from there.

**Needed before Phase 2:** an `ANTHROPIC_API_KEY` in `.env.local`. I have not checked whether one
exists on this machine.

## 3. Scope

**In:** one RFx, end to end. Co-pilot drafting, stubbed send, five messy replies, extraction,
normalized comparison grid, review queue, analyst chat with tables, charts and exports, award
scenario, award memo, extraction eval.

**Out, on purpose (these go in the one-page note):**
- Real email, auth, multi-user, multiple RFx at once.
- Negotiation rounds and auto-sending anything to vendors. Clarification emails are drafted, a
  human sends.
- Vendor portal. The brief says nobody is forced into a template.
- ERP/PO integration, supplier risk scoring, approvals workflow.
- Auto-award. The system recommends and shows its work. The buyer decides.

## 4. The fabricated dataset

Build this first. Everything else depends on it.

**One canonical truth file** (`eval/ground-truth.json`) holds what each vendor *really* quoted.
Fixture generators render each vendor's reply from it in a different messy format. That gives a
real answer key for the extraction eval.

**Hard rule: the app runtime never reads `eval/`.** No import, no fallback, no seed from it. The
comparison table is populated only by running extraction on the raw files. Add a test that fails
if anything under `app/` or `lib/` references the eval folder. This is the brief's one rule and
breaking it is disqualifying.

**RFx contents**
- 30 line items: mix of 3-ply, 5-ply and 7-ply boxes, plus a few die-cut mailers and partitions.
  Each line has SKU code, dimensions (L×W×H mm), ply, flute, GSM, burst factor, print spec, unit
  weight in grams, annual volume, unit of measure (per piece), delivery location.
- Target total spend near ₹4 crore so the brief's "₹4 crore on the line" is literal (for example
  about 20 lakh boxes at an average near ₹20: 2,000,000 × ₹20 = ₹4.0 crore).
- Last year's awarded price per line (`data/history/last-year-prices.csv`). This is legitimate
  app data, the buyer would have it. Vendor E's email depends on it.
- Questionnaire, about 10 questions: ISO 9001, FSC chain of custody, in-house BCT/burst testing,
  monthly capacity, lead time, payment terms, MOQ, price validity, rejection-rate history,
  references. Mark 3 as mandatory "quality gate" questions.
- Terms: delivery, payment, validity, penalty for late delivery.

**The five replies and the edges each one carries**

| Vendor | Format | Edges planted |
|---|---|---|
| A | Excel that ignores the template: own SKU codes, different line order, merged header rows, a notes column | Line matching by description. Some lines priced "per 100 pcs". GST-inclusive prices stated in a header note. |
| B | PDF on letterhead, clean table | 4% volume discount stated only in a footnote, conditional on a volume threshold. Attached ISO certificate that expired last month. |
| C | Word doc, commercials written as paragraphs | Quotes in USD. Price validity only 15 days. Questionnaire answered in prose. |
| D | Phone photo of a printed rate card, angled, slight blur, shadow | Quotes 27 of 30 lines. Two prices where a digit is hard to read. "Per box" where a box means a bundle of 25 for the small mailers. No questionnaire response at all. |
| E | Plain email, three lines | "₹42/kg for the 5-ply, 38 for the 3-ply, rest same as last year, freight extra." Needs kg to piece conversion from unit weight, last year's prices, and freight is unknown. |

Make the economics interesting: the cheapest overall vendor should be one that fails a mandatory
quality question, so the VP's question from the brief changes the answer. Vendor D's missing
questionnaire should make it ineligible until clarified. Fixture generators: ExcelJS for A,
HTML to PDF (Playwright) for B, `docx` for C, HTML to PNG then perspective warp, blur, noise and
JPEG compression for D (sharp or ImageMagick), a `.eml`/text file for E.

## 5. System design

```
Buyer chat ──> RFx co-pilot (tool loop) ──> RFx draft (structured, editable) ──> Outbox (stub)
                                                                                     │
Vendor files (inbox stub / upload) ──> 1 Read ──> 2 Match ──> 3 Check ──> 4 Normalize (code)
                                                                │
                                              Review queue <────┘ (flags, buyer confirms/edits)
                                                                │
                                   Comparison grid (cells + provenance + status)
                                                                │
              Analyst (tool loop: sql_query, award_scenario, sensitivity, chart, export, draft_clarification)
                                                                │
                                              Answers / tables / charts / XLSX / award memo
```

**Extraction pipeline (the real AI loop, and the highest-risk part)**

1. **Read.** One model call per document. Input is the raw file: PDF and image go to the model
   directly, Excel is parsed to a cell grid with coordinates (merged cells preserved), Word to
   text with structure, email as text. Output is a strict schema. Per quoted item: vendor's own
   description, raw price *exactly as written*, raw unit as written, raw currency, any conditions,
   and an evidence pointer (quote text plus page, cell range, or image region). Also: questionnaire
   answers with evidence, document-level terms (freight, GST, validity, discounts), and a list of
   things the vendor referred to but did not state ("same as last year").
2. **Match.** Map each vendor item to an RFx line. Model proposes the match with a reason. Lines
   with no match are recorded as `missing`, never guessed.
3. **Check.** Confidence does not come from the model saying it's confident. It comes from:
   - a second independent read of every price field, with disagreement between reads flagged;
   - code checks: price more than 3x or less than 1/3 of the cross-vendor median for that line
     (catches per-100 and per-bundle units), unit not equal to the RFx unit, currency not INR,
     vendor-stated totals that don't reconcile, coverage below 30 of 30, expired certificates,
     conditional discounts, unresolved references.
   Any flag puts the cell in `needs review` with the reason in plain words.
4. **Normalize.** Pure code. Unit conversion (per 100 pcs, per bundle, per kg using unit weight),
   FX (rate, source and date stored and editable), GST basis, discount applied or not. Each cell
   keeps `raw value → steps → normalized value`. An assumption the code had to make (FX rate,
   bundle size, freight) is a named, editable record, and changing it recomputes the grid.

**Cell model**

`rfx_line × vendor → { raw_price, raw_unit, raw_currency, normalized_unit_price_inr, status
(confirmed | needs_review | missing), flags[], evidence{doc, locator, quote}, conversion_steps[],
reviewed_by_buyer }`

**What the buyer sees when it isn't sure**
- Grid cells carry a visible state. Unreviewed cells look different from confirmed ones.
- Clicking a cell opens the source side by side: the highlighted PDF region, the Excel cell, the
  crop of the photo, the email sentence.
- A review queue sorted by rupee impact (price × annual volume), so the buyer fixes the cells that
  can move the award first. Actions: confirm, correct, mark as "ask vendor".
- "Ask vendor" drafts a clarification email (model-written, buyer-edited, stub-sent). Vendor E's
  freight and Vendor D's three missing lines and questionnaire land here.
- A coverage and comparability banner per vendor: lines quoted, lines needing review, whether the
  total is comparable (Vendor E's is not until freight is known).

**Analyst (the second real AI loop)**

A tool loop with a step budget (stop after about 8 tool calls, then answer with what it has).
Tools:
- `sql_query`: read-only connection to the normalized tables, row limit, timeout. This is what
  makes arbitrary reviewer questions answerable, not just the rehearsed ones.
- `award_scenario`: deterministic. Inputs: eligibility filter (questionnaire conditions), max
  number of vendors, treatment of unreviewed and missing cells, discount on or off. Returns the
  per-line award, totals, savings vs last year and vs best single vendor.
- `sensitivity`: reruns a scenario with flagged cells at their plausible alternates. Answers
  "does the award change if the unsure cells are wrong?"
- `render_chart`, `export_xlsx`, `export_award_memo`, `draft_clarification`.

Answer contract: every figure in an answer comes from a tool result in that turn. The UI shows the
tool calls behind each answer ("show the work"), the number of cells used, and how many were
unreviewed. If the data can't answer the question (on-time delivery history, say), the analyst
says so and names what would be needed. No hardcoded answers, no cached answers keyed on question
text.

**RFx co-pilot (the third real AI loop)**

Chat on the left, structured RFx draft on the right. The co-pilot edits the draft through tools
(`add_line_items`, `set_questionnaire`, `set_terms`, `set_vendors`). It can propose line items
from last year's buy file, asks about what's missing, and flags gaps before send (no quality gate
defined, no unit of measure stated). "Send" writes five messages to the stub outbox.

## 6. Build phases

Each phase ends with something runnable. Don't start a phase until the previous gate passes.

**Phase 0. Scaffold.** Next.js app, SQLite schema, model config in one file, `.env.local.example`,
a README with run steps. Gate: app boots, a test model call returns.

**Phase 1. Dataset and fixtures.** Ground truth JSON, RFx seed, last-year prices, five fixture
generators, attached certificates. Gate: all five files open in their native apps and look like
something a vendor would send. A human looks at each one. The photo must be hard but readable by a
person.

**Phase 2. Extraction and eval.** Read, match, check, normalize, plus `npm run eval` that scores
extraction against ground truth. Gate: eval report prints per-vendor results. See section 7 for
targets. This phase gets the most time. If it's weak, nothing after it matters.

**Phase 3. Comparison grid and review queue.** Grid, cell states, source viewer, assumptions
panel, review queue by rupee impact, clarification drafts. Gate: every planted edge in the table
in section 4 is visible to the buyer without opening the raw file, and none was resolved silently.

**Phase 4. Analyst.** Tool loop, award scenario, sensitivity, charts, XLSX and memo export. Gate:
the walkthrough questions in section 8 produce correct numbers (checked by hand against the grid),
and ten unrehearsed questions produce either a right answer or an honest "can't answer".

**Phase 5. Co-pilot and send.** Drafting chat, structured draft, outbox, inbox, upload. Gate: a
fresh RFx can be talked into existence and run through the whole flow without touching the DB.

**Phase 6. Demo hardening and deliverables.** Reset-to-clean-state script, loading and error
states, a "re-run extraction live" button, latency check, then the walkthrough recording and the
one-page note. Gate: two full cold runs with no manual fixes.

**If time runs short, cut in this order:** award memo PDF (keep XLSX), charts beyond one bar
chart, co-pilot polish (keep it functional), sensitivity tool. Never cut: provenance, cell states,
the eval, the no-ground-truth-at-runtime rule.

**On demo latency.** Extraction results persist in SQLite after a real run, so the demo opens on a
populated grid. That is stored output of real extraction, not a fixture. The "re-run" button and
the upload drop zone prove it live. Say this out loud in the demo.

## 7. Eval and launch gates

These are proposed targets, not measured results. Nothing has been run.

| Capability | Test | Metric | Target | If missed |
|---|---|---|---|---|
| Price extraction | 5 fixtures vs ground truth | Correct normalized prices ÷ quoted cells in ground truth, per vendor | 100% on cells shown as `confirmed` | Fix checks until wrong cells land in `needs review` |
| Flag recall | Planted edges in section 4 | Planted edges flagged ÷ planted edges | 100% | Add or tune the code check that should have caught it |
| Silent error (never-event) | Same run | Cells that are wrong AND shown as `confirmed` | 0 | Blocks the demo |
| Review burden | Same run | Cells in `needs review` ÷ all quoted cells | Under about 15% | Tighten checks. A queue of 100 cells is the spreadsheet again |
| Missing-line handling | Vendor D | Missing lines reported as missing ÷ missing lines | 3 of 3 | Blocks the demo |
| Analyst correctness | 15 questions with hand-computed answers | Correct ÷ asked | 15 of 15 on numeric ones | Fix tools, not prompts |
| Analyst honesty | 5 unanswerable questions | Declined with reason ÷ asked | 5 of 5 | Tighten the answer contract |
| Stability | Re-run extraction 3 times | Cells whose value changes between runs | 0 among `confirmed` | Unstable cells should be flagged by the two-read check |

The one that matters most is the never-event row. A wrong number that looks confirmed is the thing
that would cost a buyer ₹4 crore of trust. The eval report belongs in the one-page note, with the
real numbers, including the misses.

Also add two fixtures the system has never been tuned on (a sixth vendor in a new layout, and a
second photo) to check it generalizes. Reviewers will drive the live demo and may upload their own
file.

## 8. Walkthrough questions (for the recording)

Chosen to show reasoning over extracted data, not chat fluency.

1. "What came back, and what can't I trust yet?" Coverage, review queue, comparability.
2. The VP's question, word for word: "What if we split it, cheapest per line, but only among
   vendors who cleared the quality questionnaire?"
3. "What does that split cost me versus giving it all to one vendor?" Savings vs complexity.
4. "Cap it at two vendors." Constraint change on the same scenario.
5. "Which unsure cells could change that award?" Sensitivity. This is the trust question.
6. "Vendor E said freight extra. At what freight cost do they stop being cheapest on the lines
   they win?" Breakeven, computed.
7. "Where are prices up most against last year?" Chart.
8. "Draft what I need to ask Vendor D." Clarification email.
9. "Which vendor has the best on-time delivery record?" The system says it has no such data.
10. "Export the award recommendation." XLSX plus memo, with open flags listed on the memo.

## 9. The one-page note (draft the skeleton now, fill with real results)

- The decision: effort went to uncertainty handling over breadth, and why.
- Five judgment calls with the reason for each: model reads / code computes; confidence from
  disagreement and checks, not self-report; review queue sorted by rupee impact; no auto-award and
  no auto-send; stored extraction with live re-run.
- Eval results, real numbers, misses included.
- Left out on purpose (section 3) and what would come next.
- "The interesting problem was somewhere else." Candidate angle, **Assumption** to test while
  building, not a finding: the hard part isn't reading messy quotes, it's that quotes arrive
  incomplete and non-comparable, so the real product is the clarification loop that makes vendors
  comparable before anyone analyzes anything. Keep it only if building the prototype bears it out.
  Write what was actually observed.

## 10. Risks and open items

| Risk | What to do |
|---|---|
| Angled photo extraction is unreliable | That's the point of the photo. The requirement is that wrong reads get flagged, not that every digit is right. Tune the fixture so a person can read it. |
| Live demo: reviewer uploads an unseen format | Section 7's held-out fixtures. Failure mode must be "flagged for review", never a crash or a confident wrong cell. |
| Analyst writes bad SQL or a wrong number | Read-only connection, row limits, figures only from tool results, tool calls visible in the UI. |
| Latency on stage | Stored results, streaming responses, re-run button for proof. |
| Looks hardcoded to a skeptical reviewer | Runtime isolation test for `eval/`, upload path, re-run button, unrehearsed questions invited. |
| Model IDs or SDK shapes differ from this plan | `/claude-api` before any SDK code. One config file for model IDs. |

**Open, needs a human answer:**
- Timeline and demo date. Both are blank in the brief screenshots. Phases are ordered, not dated.
- Anthropic API key and budget for the build.
- Whether the demo runs from a laptop (this plan assumes yes) or needs a hosted URL. Hosting
  changes the SQLite and file-storage choices.
