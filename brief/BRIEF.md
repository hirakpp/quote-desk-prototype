# Aerchain take-home brief (transcription)

Transcribed from the four screenshots in this folder (`brief-p1-top.png`, `brief-p1-bottom.png`,
`brief-p2-top.png`, `brief-p2-bottom.png`). The screenshots are the source of truth. If this text
and a screenshot disagree, the screenshot wins.

Source PDF name visible in the screenshot: `Aerchain-Product-Assignment (1).pdf`, 2 pages,
marked "AERCHAIN · CONFIDENTIAL".

---

**PRODUCT / TAKE-HOME ASSIGNMENT**

# Kill the Quote Spreadsheet

Build the system that drafts an RFx, reads whatever vendors send back, and lets a buyer
interrogate the result in plain language.

## The week we want you to delete

A category buyer needs 30 line items of corrugated packaging. Or IT hardware, or MRO spares, or
freight lanes – you'll pick the category.

They write an RFx. They email five vendors. Over the next nine days, this comes back: a beautiful
Excel that ignores the template entirely. A PDF on letterhead with the discount buried in a
footnote. A Word doc where the commercials are in a paragraph. A photo of a printed rate card,
taken at an angle, on a phone. And one email that just says *"₹42/kg for the 5-ply, 38 for the
3-ply, rest same as last year, freight extra."*

The buyer opens Excel and retypes all of it. Three days gone. Then the VP asks one question –
*"what if we split it, cheapest per line, but only among vendors who cleared the quality
questionnaire?"* – and there goes the fourth.

This happens every day, in every procurement team on earth, and everyone has quietly accepted it
as the cost of doing business. We haven't. **Build the thing that ends it.**

## What you're building

**One flow, end to end.**

A buyer *talks* an RFx into existence with an AI co-pilot – scope, line items, questionnaire,
terms. It goes out to vendors over a channel you choose. Vendors reply however they like; nobody
is forced into your template. Your system reads every response, whatever shape it arrives in, and
lands them all in a single side-by-side comparison – same lines, same units, same currency – with
questionnaire answers and attached docs sitting alongside the numbers.

Then the buyer stops clicking and starts asking. Natural language, over the whole comparison. Text
answers, tables, charts, exports. Real analysis on real extracted data, all the way to a
defensible award decision.

Build the demo at a size where it actually hurts: five vendors, thirty line items, a
questionnaire, attached documents. Fabricate a dataset a procurement person would nod at.

## Total liberty

You pick everything – the agent framework, the model(s), the email path, the storage, the UI, the
personas, the industry, the data, the export formats, the guardrails. No house style, no hidden
right answer.

> One rule: **stub the plumbing, but the AI loops must be real.** Fake the SMTP server if you
> like. Don't fake the extraction, don't fake the reasoning, don't hardcode the answers to your
> demo questions.

## What we're actually looking at

Everyone can build the happy path. We care about the rest:

- **The ugly edges.** The angled photo. The vendor who quoted 27 of 30 lines. The one who quoted
  in USD. The one whose "per box" is someone else's "per 100 pieces." What does your system do –
  and what does it *show the buyer* – when it isn't sure?
- **Trust.** Would a buyer with ₹4 crore on the line act on what's on your screen? What did you
  build to earn that?
- **Judgment and taste.** A thousand decisions here have no correct answer. We want to see how you
  made them, and whether you can say why.

## Deliverable

A working prototype, ready for a live demo we'll drive with you. A recorded walkthrough of the
analyst conversation – you choose the questions worth asking. And a one-page note on what you
decided, and what you deliberately left out.

TIMELINE: (blank in the screenshot)    DEMO: (blank in the screenshot)

If you finish this and think *"the interesting problem was actually somewhere else"* – tell us
that too. We'd rather hire the person who found the better problem than the one who followed the
brief perfectly.

**Have fun with it.**
