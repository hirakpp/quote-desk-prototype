# One-page note (draft)

Status: draft, updated 2026-10-10 after Part 3 of the build plan (the redesign and MRO spares). Numbers marked TO MEASURE are blank
on purpose. Fill them from a real run, not from memory. A blank is better than a guess.

## What I decided

Spend the build on what the system does when it is not sure, and on making the first screen after
"go" one answer for the person who decides, not a spreadsheet.

## The calls and why

1. **The model reads, code computes.** The model records what each document says and matches lines.
   Units, currency, discounts, quantity breaks, "same as last year", totals and award scenarios are
   plain functions.
2. **Rules are not doubts.** A conversion that code applied to many of one vendor's prices for one
   stated reason ("quoted in USD") is a rule: one card, accepted once, and a quiet mark in the cell.
   A doubt is something wrong with one price: far from other vendors, far from your own reference
   price, a substitute item, a reader's note. Only a doubt turns a cell amber. On a perfect read of
   the packaging sample that is 0 amber cells and 6 rules, where the first version showed 102 amber
   cells.
3. **"Not firm yet" is said once, in red.** A price under a rule you have not accepted still counts
   as unconfirmed. The Decide screen shows the lowest award you can make and, under it, one red
   strip that says how many of its prices rest on things you have not confirmed. Each of those
   things is a red tile with the vendor's words one click away. Confirm it and the tile turns
   green. When none is left the strip turns green and says "Firm". Only the confirmations that
   change that award are tiles. The rest wait behind one link. Every award scenario on Ask also
   says in words how many unconfirmed prices it used. Red means act now and green means done or
   good. Three quiet text colours mark kinds of thing, the same on every page: gold for money that
   is not the headline figure, lilac for codes and files, sky for section headings.
4. **A conditional discount is your decision.** Kraftline's 4% depends on offtake above ₹50 lakh,
   which a split award may not reach. Prices show list price until you choose.
5. **No auto-award.** The analyst computes a scenario and says what to check. A what-if (changed
   quantity, moved prices, diesel up ₹5) is labelled as a what-if wherever its number appears,
   including the Excel export.
6. **Open model layer.** Anthropic or OpenAI, your choice, each on your own key, called straight from
   the browser. No server holds a key or a document.
7. **Four sourcing events, each wrong in a different way if you just take the cheapest.** Packaging:
   the cheapest vendor has not cleared the quality gate. IT hardware: the cheapest prices are for
   substitute models. Freight: the cheapest carrier cannot supply enough trucks. MRO spares: no
   vendor covers the list, some low prices are for an equivalent make, and some minimum orders are
   above what the plant uses in a year.
8. **The headline is a sentence picked by code.** The line at the top of Decide ("Two of five
   vendors can be awarded today") and the line under it come from a few fixed templates, the count
   of vendors through the quality gate, and the grid. The award figure is `awardScenario` among
   gate-cleared vendors. The model writes none of it. The screen shows the lowest award that can be
   made. It never says "award this".
9. **A minimum order is a rule, like a conversion.** Where a vendor's minimum is above the yearly
   need, code costs the line at the minimum, marks the cell `MOQ`, and asks you to accept that once
   per vendor. Award scenarios report what the minimums add.

## What was measured

**Conversion code, no model** (`handcheck.mjs --selftest`, a perfect reading built from the answer
key, run 2026-10-10). This proves the arithmetic, not the reading.

| Dataset | Cells right | Amber cells | Rules to accept | Check against a hand calculation |
|---|---|---|---|---|
| Packaging | 150 of 150 | 0 | 6 | Split among gate-cleared vendors: ₹3,98,33,232.40, matches |
| IT hardware | 150 of 150 | 6 (the six substitutes) | 4 | Exact-match only: ₹3,88,59,851.12, matches. It moves 6 lines to another vendor |
| Freight | 150 of 150 | 6 | 3 | Within stated truck limits: ₹3,99,16,380.00, matches. The cheapest carrier's share falls from 83.75% to 37.03% |
| MRO spares | 150 of 150 | 6 (the six equivalents) | 6 | Fewest gate-cleared vendors covering all 30 lines: 3, matches. Cheapest per line: ₹23,45,369.20, of which minimum orders add ₹35,049.80, both match. Exact make only leaves L19 and L22 with no price, matches |

**Planted misreads on packaging** (a reader that misses a unit must still produce an amber cell): per
100 read as per piece, box of 25 read as per piece, USD read as INR, a 1.5x digit error, and per kg
read as per piece on a 400 g carton all turn amber. **One does not:** per kg read as per piece on a
carton near 1 kg (L20) gives ₹42 against a true ₹44.10, a 5% error that no price check can see. That
gap is real and stays open.

**Reading with a live model: not measured.** No API key was available during this build, so no
extraction and no analyst answer has been run on the Part 2 or Part 3 code, on either provider.

| | Anthropic | OpenAI |
|---|---|---|
| Packaging: cells right / wrong but amber / wrong and not amber | TO MEASURE | TO MEASURE |
| IT hardware | TO MEASURE | TO MEASURE |
| Freight | TO MEASURE | TO MEASURE |
| MRO spares | TO MEASURE | TO MEASURE |
| Model and date of each run | TO MEASURE | TO MEASURE |
| Demo questions checked by eye | TO MEASURE | TO MEASURE |

The two providers are not claimed to be equivalent. Neither has been measured.

**OpenAI from the browser.** `api.openai.com` returns browser CORS headers on `/v1/responses` and
`/v1/models`, and a real browser on `localhost` got a readable "key rejected" reply from both
providers. So no relay was built. A successful call with a real OpenAI key from the deployed site has
not been made.

## Left out on purpose

Database, accounts, real email, more than one RFx at a time. A formal eval. Highlighting the region
of a PDF or photo. Award memo, sensitivity tool, clarification-email workflow, editable currency
rates. A phone layout for the grid. A second read by the other provider. A fleet-wide truck limit
across lanes (limits are per lane). An approved-brand list for MRO equivalents. The "Draft a note to
the vendor" button shown in the design mock. The fuller original plan is in `archive/`.

No longer left out: what is left to confirm, largest money first, is now the tiles on Decide, and
MRO spares is the fourth dataset.

## Where the build differs from the design mocks

Built to two files: `design/vp-dark-colour.html` (Decide) and `design/pages-dark.html` (Home, RFx,
Replies, Compare, Ask, the key screen, Questionnaire and terms, the source sheet, the reading state,
and the empty and error states). Checked by screenshots next to the mocks at 1440 wide on packaging,
with a pass at 390 wide and on the other three datasets. These are the places the build differs,
each a call I made instead of stopping to ask:

- **The back button is hidden on the list of events.** The mock draws it there too, where it has
  nowhere to go.
- **Under 1040px, Decide, Compare, Ask sit in a row under the toolbar.** The mocks hide them.
- **The key screen is a dialog,** as it was, styled as the mock's centred card with the app's own
  wording. It also keeps "Forget this key".
- **Compare keeps the filter row** (All, Flagged, Missing, Converted, Show, Export) under the key.
  The mock has no place for it. Cells also keep their small marks (`USD`, `÷100`, `sub`, `MOQ`),
  now at 13px.
- **The grid's head stays put while the lines scroll,** so it sits on a solid strip. The mock's
  table has 8 lines and no need for it.
- **A failed gate shows the vendor's own answer,** cut to two lines. The mock shows a tidy
  summary. Code cannot summarise an answer.
- **A tile on Decide is a rule or doubt under a price the award uses.** Doubts of one kind on one
  vendor are one tile. Both are from Part 4 and unchanged.
- **The source sheet's Confirm clears everything that price rests on:** the vendor's open
  conversions and any doubt on the cell. "It's wrong" opens a box to type the right price. The
  sheet also keeps the walk through everything still to confirm, and "Beside the price".
- **An answer on Questionnaire and terms opens its own sheet** with the vendor's words, as the plan
  says. The sheet is not drawn for an answer, so it follows the price sheet.
- **Ask shows the options computed for one answer inside that answer.** The side tray that lined up
  every scenario across the whole conversation is gone, since the mock has no place for it.
- **Figures in the analyst's sentences are coloured by code,** not by the model: a rupee amount is
  gold, and one followed by "under" or "less" is green.
- **On Home, a question is a button only once the replies are read.** It then goes to the live
  analyst. Before that the list has no chevrons.
- **Nobody through the gate:** one card with the reasons and the way to Compare, as drawn. The
  Part 4 list of what each vendor would have to do is gone.
- **Sizes outside the seven in the plan's table,** all taken from the mocks: 14px for row buttons,
  chips and context lines, 30px for an answer's headline and an empty state's title, and the hero
  figure on Decide.

**Contrast, computed from the token values.** On neutral glass over the plain ground: white on a red
tile 11.1, on a green tile 9.9, the 82% white line 8.0 and 7.3, `ink-2` 7.8, red text 5.8, green
text 7.3, links 4.9, `ink-3` (labels and captions) 4.45. The Part 5 colours: gold 9.6, dimmed gold
5.9, sky 8.1, lilac 7.8, the lilac file names 5.0, lilac on its tag 5.7. Glass lets the blooms through, so near the
top corners these fall. At the centre of the strongest bloom, which is off screen, `ink-3` would be
3.4. `ink-3` is the mock's own value and I did not change it. It sits just under 4.5 for small
text. This is a calculation, not a measurement on a screen.

## Known rough edges

- The first live read (2026-10-10) was rejected by Anthropic: "The compiled grammar is too large". The
  extraction schema was then flattened (no nullable types, no lists inside list items). Whether the
  flatter schema is accepted has not been confirmed by a live read yet. Part 3 added one more value
  to it (a minimum order entry), kept inside the existing details list so the schema grows as little
  as possible.
- MRO spares has never been read by a model. Three things in it are likely to be hard and are not
  measured: the handwritten counter quote, a minimum order stated in cartons, and "list less 32%",
  which a reader could wrongly record as a discount.
- The OpenAI adapter is written from the API reference as I know it and has never been run with a
  key. Treat it as untested.
- The 40% reference-price check has only been tried on correct prices from the answer keys, where it
  fires once, rightly (a per-km rate on a 40 km lane). Whether it fires too often on a live read is
  not known.
- Vendors who leave freight or tolls out are flagged, but no amount is added to their prices. The
  data to do that was never asked for. Since Part 4, "can be awarded" means through the quality
  gate, on Decide and in the grid alike, so such a vendor can hold the lowest marker on a line. Its
  row on Decide says "tolls extra".
- Currency is converted at fixed demo rates shown in the UI.
- With the conditional discount off by default, the cheapest single vendor on packaging is Sai
  Cartons (did not answer the questionnaire, freight extra), not Kraftline (failed the gate).
- The design detector named in the plan (`impeccable detect`) was not found on this machine and was
  not run.
- The redesign was reviewed by me against the mocks, not by a second reviewer.
- Parts 4 and 5 were checked in headless Chromium only. The blur and the silver product name were not
  checked in Safari.
- The source sheet covers the right 460px of the grid, as drawn. A price in the last two vendor
  columns sits under it while its sheet is open.
