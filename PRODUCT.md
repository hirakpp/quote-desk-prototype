# Product

<!-- impeccable:product-schema 1 -->

Written 2026-10-10 from `brief/BRIEF.md`, `BUILD_PLAN.md` and the built app. Nothing here came
from a fresh interview. The reviewer has not checked this file line by line.

## Platform

web

## Users

- **The category buyer** at a mid-size Indian company. They ran a sourcing event (an RFx) for
  about 30 line items, sent it to five vendors, and got five replies back in five different
  shapes. Today they retype all of it into Excel over three days. They sit at a desk with a
  laptop or monitor, in office light, with the vendor files open beside the tool.
- **Their VP**, who asks one "what if" question and expects a number they can defend.
- **The Aerchain panel** judging the take-home. They drive a live demo and look for the ugly
  edges, trust, and taste.

## Product Purpose

Quote desk reads whatever vendors send back, puts every reply on the same lines, units and
currency, shows the buyer what it is unsure about, and lets them ask questions in plain language
all the way to an award decision they can defend. Success: a buyer with about ₹4 crore on the
line would act on what is on the screen.

## Positioning

Nothing is filled silently. Every price traces to the vendor's own words, and every conversion
(per 100 to per piece, USD to INR, per kg to per piece, "same as last year") is a rule the buyer
accepts before a total is treated as firm. The model reads. Code computes.

## Operating Context

- Vendor replies arrive as an Excel sheet, a PDF on letterhead, a Word doc, an angled phone photo
  of a printed rate card, and a three-line email.
- An RFx has line items with annual volumes, a quality questionnaire with a pass or fail gate, and
  commercial terms (freight, GST, validity, payment, discounts).
- Money is Indian rupees, written in lakh and crore. Last year's price per line is the reference.
- Four sample events: corrugated packaging, IT hardware, road freight lanes, MRO spares.
- The buyer's moves: accept or reject a conversion, open the source file, compare prices per
  line, check questionnaire answers and terms, ask the analyst, export.

## Capabilities and Constraints

- Static site. The user pastes their own API key (Anthropic or OpenAI). The key stays in the
  browser.
- Extraction and analyst answers are live model calls. Email send and receive is simulated and
  labelled so.
- Answer keys never reach the app. No dataset ships an answer.
- Vite, React 19, TypeScript, Tailwind v4, Recharts. Geist is the current typeface.
- Desktop first. The comparison grid is 30 rows by 5 vendors.

## Brand Commitments

- Product name: Quote desk.
- Voice: plain words, short sentences, no em dashes.
- No logo, no brand colour and no typeface is binding. The visual identity is open.

## Evidence on Hand

- Real computed numbers for all four datasets from a perfect read (`scripts/datasets/*.mjs`,
  `scripts/handcheck.mjs`).
- Sample vendor files in `public/samples/`.
- No customers, testimonials or benchmarks. Do not invent any.

## Product Principles

1. Show doubt where it is, and nowhere else.
2. The vendor's own words sit beside every number.
3. The buyer decides. The tool never awards on its own.
4. One answer first, the working underneath.
5. A procurement person should nod at the data.
