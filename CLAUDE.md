# Aerchain RFx prototype

PM take-home: "Kill the Quote Spreadsheet". Hosted as a static site, users bring their own API
key. Read `brief/BRIEF.md` (the assignment) and `BUILD_PLAN.md` (the plan) before doing anything.
`archive/` is the older, bigger plan and is reference only.

**Where the build is (2026-10-10, later).** Part 1 (sections 1 to 9) and Part 2 (sections 10 to
21) are built on the `part-2` branch, on the default for each of the five decisions in section 10.
What is left is the part that needs a human: a live run with a real key on each provider, the hand
check numbers in `NOTE.md` (still TO MEASURE), and the deploy. Where Part 2 and Part 1 disagree,
Part 2 wins.

**Part 3 (sections 22 to 27) is built too:** the redesign to `design/mock.html` and MRO spares as
a fourth dataset. The reviewer confirmed the five defaults in section 10 on 2026-10-10. Where Part 3
and Part 2 disagree, Part 3 wins. For any further UI work, open `design/mock.html` first and
compare screenshots with it side by side. What is still left is the same human part: a live run
on each provider, the hand check numbers, and the deploy.

**Part 4 (sections 28 to 33) is built too:** the decision view in frosted graphite. The reviewer
rejected the Part 3 look and approved `design/vp-dark-colour.html` on 2026-10-10. That file is the
design spec, and it replaces `design/mock.html`. For any further UI work, open it in a browser
first and compare screenshots side by side. Where Part 4 and Part 3 disagree, Part 4 wins. Only
the Decide screen is drawn. Compare and Ask follow the rules in section 31 and have not been
checked by the reviewer. Still left: a live run on each provider, the hand check numbers, the deploy.

**Part 5 (sections 34 to 37) is built too (2026-10-11):** text colour and one type scale on every
page. The reviewer looked at the Part 4 build on 2026-10-10: pages other than Decide were all white, and
text sizes were inconsistent. For any further UI work, open both spec files in a browser first: `design/pages-dark.html` (ten pages and states, keys 1 to 9 and 0)
and `design/vp-dark-colour.html` (Decide). It is a styling pass only.

## Rules that don't bend

- **AI loops are real.** No faked extraction, no hardcoded or cached answers to demo questions.
  Email send/receive is stubbed and labeled as simulated in the UI.
- **No API key in the repo or the build.** The user pastes their key in the UI. It lives in
  browser `localStorage` only. Never log it, never put it in a URL. It goes only to the provider
  the user picked. If OpenAI needs the relay in plan section 15.3, the relay stores and logs
  nothing and the key screen says it exists.
- **The answer keys never reach the app.** `scripts/truth.json` and `scripts/truth/*.json` are not
  imported by `src/` and not copied to `public/`. The grid is filled only by extraction. No
  dataset ships an answer.
- **The model reads, code computes.** Units, currency, totals and award scenarios are plain
  functions. The analyst gets numbers from tools only.
- **Every cell shows its source quote. Never fill silently.** Unsure is `needs review` with a
  plain reason. Absent is `missing`.
- **Report honestly.** Say what was run and what wasn't. Numbers in the note are measured ones.

## Working notes

- Run `/claude-api` first: confirm direct browser calls work, and take model IDs and PDF/image
  input shapes from there. Model IDs live in one config file.
- Deploy in the first hour, then redeploy at the end.
- Plan section 29 and `design/vp-dark-colour.html` are the design bar. Sections 14 and 23 are replaced. Still skip
  tests and abstractions the plan doesn't ask for.
- Everything in `design/` is a reference only. Never import it from `src/` and never deploy it.
- `PRODUCT.md` is product facts for design work. It was written from the brief and the plan.
- Run `node scripts/handcheck.mjs --dataset all --selftest` after touching `src/lib/`. It needs no key.
- Don't hardcode OpenAI model IDs. List them from the API with the user's key.
- Copy in docs and UI: plain words, no em dashes.
