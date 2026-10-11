import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PROVIDER_LABEL } from '../config.ts'
import { awardScenario } from '../lib/analysis.ts'
import type { AwardResult } from '../lib/analysis.ts'
import { acceptRule, chooseDiscount, confirmDoubts, unconfirmDoubts } from '../lib/decisions.ts'
import { DOUBT_TITLES, doubtCards, extrasLabel, inrShort, moneyParts, moneyUnit, perComma, referenceTotal, shortName } from '../lib/normalize.ts'
import type { Cell, Decisions, Grid, LineItem, Reply, Rule, VendorSummary } from '../lib/types.ts'
import { useStore } from '../store.tsx'
import { Button, CARD_TITLE, CTX, Empty, ErrorTile, GOLD, LEDE, LINK, LINK_ON_TILE, Money, Slip, stepRows } from './ui.tsx'

// Decide: the first screen of Results, for the person who decides. One answer, who it rests on,
// and only the confirmations that change that answer. Every figure here comes from
// awardScenario or the grid. Every sentence is picked by code from a few templates.

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const word = (n: number) => WORDS[n] ?? String(n)
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)
// "under last year", "under the last PO price".
const refWords = (grid: Grid) => (/^last year$/i.test(grid.rfx.refLabel) ? 'last year' : `the ${grid.rfx.refLabel} price`)
const canAward = (v: VendorSummary) => v.gate === 'pass'

// Why the blocked vendors are blocked, as one sentence: "Two sent no quality questionnaire and one failed the gate."
function blockedWhy(blocked: VendorSummary[]): string {
  const n = (g: VendorSummary['gate']) => blocked.filter((v) => v.gate === g).length
  const bits = [
    n('not_answered') ? `${word(n('not_answered'))} sent no quality questionnaire` : '',
    n('fail') ? `${word(n('fail'))} failed the gate` : '',
    n('unclear') ? `${word(n('unclear'))} gave an unclear answer on the gate` : '',
  ].filter(Boolean)
  return bits.length ? `${cap(list(bits.map(low)))}.` : ''
}

// One reason under a vendor's name. The same words feed the line under the headline.
function reason(grid: Grid, v: VendorSummary): string {
  const gates = grid.questionnaire.filter((q) => q.gate)
  const failed = gates.filter((q) => v.answers[q.id]?.meets_requirement === 'no')
  const parts: string[] = []
  if (gates.length === 0) parts.push('No quality gate in this RFx')
  else if (v.gate === 'pass') parts.push('Cleared the quality gate')
  else if (v.gate === 'fail') parts.push(`Failed the gate${failed[0] && v.answers[failed[0].id]?.answer ? `: ${v.answers[failed[0].id]!.answer}` : ''}`)
  else if (v.gate === 'not_answered') parts.push('No questionnaire')
  else parts.push('A gate answer is unclear')
  if (v.gate !== 'fail') {
    if (v.linesQuoted === 0) parts.push('no prices in the reply')
    else if (v.linesQuoted < v.totalLines && grid.commonLineIds.length > 0) parts.push(`quoted ${v.linesQuoted} of ${v.totalLines} lines`)
    // On a price you can use, what is left out of it matters. On a blocked vendor the gate is the reason.
    if (canAward(v) && v.freight === 'extra') parts.push(`${extrasLabel(grid.rfx).toLowerCase()} extra`)
  }
  return parts.join(', ')
}

// ---- What is left to confirm ----
type Item =
  | { kind: 'rule'; id: string; rule: Rule; vendor: VendorSummary; cleared: boolean; cell: Cell | null; line: LineItem | null; touched: number; amount: number }
  // Doubts of one kind on one vendor are one tile, however many lines they sit on.
  | { kind: 'doubt'; id: string; cell: Cell; line: LineItem; cells: Cell[]; vendor: VendorSummary; cleared: boolean; amount: number }

// Tiles are the rules and doubts under a price the award uses. Everything else changes nothing
// about this answer, so it waits behind one link.
function confirmItems(grid: Grid, r: AwardResult | null): { tiles: Item[]; rest: Rule[]; otherDoubts: number } {
  const byId = new Map(grid.vendors.map((v) => [v.replyId, v]))
  const lineById = new Map(grid.lines.map((l) => [l.id, l]))
  const used = new Set((r?.awards ?? []).map((a) => `${a.vendor_id}|${a.line}`))
  const inAward = new Set((r?.vendors_in_award ?? []).map((v) => v.vendor_id))
  const tiles: Item[] = []
  const rest: Rule[] = []
  for (const rule of grid.rules) {
    if (rule.code === 'vendor_attribute') continue
    const hit = rule.lineIds.filter((id) => used.has(`${rule.replyId}|${id}`))
    const vendor = byId.get(rule.replyId)
    if (!vendor || !inAward.has(rule.replyId) || hit.length === 0) {
      rest.push(rule)
      continue
    }
    tiles.push({ kind: 'rule', id: `r|${rule.id}`, rule, vendor, cleared: rule.accepted, cell: grid.cells[rule.replyId][hit[0]], line: lineById.get(hit[0]) ?? null, touched: hit.length, amount: rule.amount })
  }
  const seen = new Set<string>()
  for (const a of r?.awards ?? []) {
    const cell = grid.cells[a.vendor_id]?.[a.line]
    const vendor = byId.get(a.vendor_id)
    const line = lineById.get(a.line)
    const k = `${a.vendor_id}|${a.line}`
    if (!cell || !vendor || !line || cell.doubts.length === 0 || seen.has(k)) continue
    seen.add(k)
    const id = `d|${a.vendor_id}|${cell.doubts.map((x) => x.code).join('+')}`
    const have = tiles.find((x) => x.id === id)
    if (have && have.kind === 'doubt') {
      have.cells.push(cell)
      have.cleared = have.cleared && cell.check !== 'look'
      have.amount += a.cost
    } else tiles.push({ kind: 'doubt', id, cell, line, cells: [cell], vendor, cleared: cell.check !== 'look', amount: a.cost })
  }
  tiles.sort((a, b) => b.amount - a.amount)
  return { tiles, rest: rest.sort((a, b) => b.amount - a.amount), otherDoubts: doubtCards(grid).filter((d) => !seen.has(`${d.replyId}|${d.lineId}`)).length }
}

const CURRENCY: Record<string, string> = { USD: 'US dollars', EUR: 'euros', GBP: 'pounds', AED: 'dirhams' }

// A plain title naming the vendor and what they did.
function ruleTitle(rule: Rule, who: string, all: number): string {
  const per = /^Quoted per (.+?), converted/.exec(rule.title)?.[1]
  const cur = /^Quoted in (\w+)/.exec(rule.title)?.[1]
  const n = rule.lineIds.length
  const where = n >= all ? 'every line' : n === 1 ? 'one line' : 'some lines'
  if (rule.code === 'currency' && cur) return `${who} quoted in ${CURRENCY[cur] ?? cur}`
  if (rule.code === 'unit' && per) return `${who} priced ${where} per ${per}`
  if (rule.code === 'reference') return `${who} wrote no price on ${n === 1 ? 'one line' : `${n} lines`}`
  if (rule.code === 'tier') return `${who} quoted price breaks by quantity`
  if (rule.code === 'moq') return `${who} has a minimum order above what you need`
  if (rule.code === 'discount') return rule.choice ? `${who} offers ${rule.choice.percent}% off on a condition` : `${who} took ${/^(\d+(\.\d+)?)%/.exec(rule.title)?.[1] ?? 'a'}% off`
  return `${who}: ${low(rule.title)}`
}
// One line on what code did about it. The rule's first sentence only says where, so drop it.
function ruleDid(rule: Rule): string {
  if (rule.choice) return rule.text
  const rest = rule.text.split('. ').slice(1).join('. ')
  return rest || rule.text
}

export function Decide() {
  const { state, grid, go, datasets, readAll, readReply, withModel, set, openCompare, askNow } = useStore()
  const replies = state.replies
  const n = replies.length
  const reading = replies.filter((r) => r.status === 'extracting').length
  const read = grid.vendors.length
  const waiting = replies.filter((r) => r.status === 'received' || r.status === 'error').length
  const ready = read > 0 && reading === 0
  const ok = useMemo(() => grid.vendors.filter(canAward), [grid])
  const blocked = useMemo(() => grid.vendors.filter((v) => !canAward(v)), [grid])

  const award = useMemo(() => {
    if (!ready || ok.length === 0) return null
    const r = awardScenario(grid, { eligible_vendors: 'passed_quality_gate' })
    return 'error' in r || r.lines_awarded === 0 ? null : r
  }, [grid, ready, ok.length])
  const items = useMemo(() => confirmItems(grid, award), [grid, award])

  if (n === 0) {
    return (
      <Empty
        title="No replies yet"
        text="The answer, the vendors and what is left to confirm appear here once vendor files arrive and are read."
        action={
          <Button variant="primary" onClick={() => go('replies')}>
            Go to the replies
          </Button>
        }
      />
    )
  }

  const event = datasets.find((d) => d.id === state.datasetId)
  const kind = event?.kind.toLowerCase() ?? (grid.rfx.period === 'year' ? 'rate contract' : 'one-time buy')
  const ctx = [shortName(grid.rfx.buyer), kind, ready ? `${read}${read < n ? ` of ${n}` : ''} ${plural(read < n ? n : read, 'reply', 'replies')} read` : ''].filter(Boolean).join(' · ')
  const N = grid.vendors.length
  const decide = (fn: (d: Decisions) => Decisions) => set((s) => ({ ...s, decisions: fn(s.decisions) }))
  const readRest = () => withModel((l) => readAll(l))

  // How many of the blocked replies are cheaper than every reply that can be awarded.
  const shared = grid.commonLineIds.length > 0
  const floor = Math.min(...ok.map((v) => v.likeForLike ?? Infinity))
  const lead = shared && ok.length > 0 ? blocked.filter((v) => v.likeForLike != null && v.likeForLike < floor).length : 0

  let head: ReactNode
  let sub: ReactNode
  if (reading > 0) {
    head = (
      <>
        Reading {word(n).toLowerCase()} {plural(n, 'reply', 'replies')}. <span className="text-ok block">{read === 0 ? 'None is done yet.' : `${word(read)} ${plural(read, 'is', 'are')} done.`}</span>
      </>
    )
    sub = `Each vendor fills in as its file lands. ${PROVIDER_LABEL[state.provider]} reads them in parallel, one live model call per file, on your own key.`
  } else if (read === 0) {
    head = `${word(n)} ${plural(n, 'reply is', 'replies are')} waiting to be read.`
    sub = 'Reading takes a live model call per file, on your own key.'
  } else if (ok.length === 0) {
    head = 'No vendor can be awarded yet.'
    sub = blockedWhy(blocked)
  } else {
    head = (
      <>
        <span className="text-ok">
          {word(ok.length)} of {word(N).toLowerCase()}
        </span>{' '}
        {plural(N, 'vendor', 'vendors')} can be awarded today.
      </>
    )
    sub =
      blocked.length === 0 ? (
        grid.questionnaire.some((q) => q.gate) ? (
          'Every vendor cleared the quality gate.'
        ) : (
          'This RFx has no quality gate, so every reply can be used.'
        )
      ) : (
        <>
          {lead > 0 && (
            <>
              The <span className="text-stop">{lead === 1 ? "cheapest reply can't" : `${word(lead).toLowerCase()} cheapest can't`} be used yet</span>.{' '}
            </>
          )}
          {blockedWhy(blocked)}
        </>
      )
  }

  const vendors = <Vendors grid={grid} replies={replies} ready={ready} reading={reading > 0} onVendor={(id) => openCompare({ kind: 'vendor', replyId: id })} onRetry={(id) => withModel((l) => void readReply(id, l))} />
  const page = 'page-w pt-10 pb-14 grid grid-cols-1 min-[1040px]:grid-cols-[minmax(0,1fr)_minmax(0,560px)] gap-x-14 gap-y-7 items-start'
  const stateCard = 'glass card px-[30px] max-sm:px-5 py-7'
  const stateTitle = 'text-2xl font-semibold tracking-[-0.02em] text-ink text-balance'

  // Nothing is read: an empty state, not a headline.
  if (read === 0 && reading === 0) {
    return (
      <div className={page}>
        <section className={stateCard}>
          <h1 className={stateTitle}>Nothing to decide yet.</h1>
          <p className="mt-2 text-lg font-normal text-ink-2">
            {word(n)} {plural(n, 'reply', 'replies')} came back and {n === 1 ? 'it is not' : 'none is'} read yet. Reading takes a live model call per file, on your own key.
          </p>
          <div className="mt-[18px] flex gap-2.5 flex-wrap">
            <Button variant="primary" size="lg" onClick={readRest}>
              Read {n === 1 ? 'it' : `all ${n}`} and compare
            </Button>
            <Button size="lg" onClick={() => go('replies')}>
              See the replies
            </Button>
          </div>
        </section>
        <aside className="min-w-0">{vendors}</aside>
      </div>
    )
  }
  // Every reply is read and nobody is through the gate: no figure, and the way to the prices.
  if (ready && !award) {
    return (
      <div className={page}>
        <section className={stateCard}>
          <div className={CTX}>{ctx}</div>
          <h1 className={`${stateTitle} mt-2`}>
            <span className="text-stop">No vendor</span> can be awarded yet.
          </h1>
          <p className="mt-2 text-lg font-normal text-ink-2">{blockedWhy(blocked)} You can still look at the prices.</p>
          <div className="mt-[18px] flex gap-2.5 flex-wrap">
            <Button variant="primary" size="lg" onClick={() => openCompare()}>
              Open Compare
            </Button>
            <Button size="lg" onClick={() => go('replies')}>
              See the replies
            </Button>
          </div>
        </section>
        <aside className="min-w-0">{vendors}</aside>
      </div>
    )
  }

  return (
    <div className={page}>
      <section className="pt-1.5 min-w-0">
        <div className={CTX}>{ctx}</div>
        <h1 className="headline mt-3">{head}</h1>
        <p className={`${LEDE} mt-4 !max-w-[30em]`}>{sub}</p>
        {reading === 0 && waiting > 0 && (
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <Button variant="primary" size="lg" onClick={readRest}>
              Read the other {word(waiting).toLowerCase()} and compare
            </Button>
            <span className="text-sm text-ink-3">
              {word(waiting)} of {word(n).toLowerCase()} {plural(n, 'reply', 'replies')} {plural(waiting, 'is', 'are')} not read, so this is a partial picture.
            </span>
          </div>
        )}
        {reading > 0 ? <AwardSkeleton n={n} /> : award ? <AwardCard grid={grid} r={award} items={items.tiles} onAsk={askNow} /> : null}
      </section>

      <aside className="grid gap-[22px] min-w-0">
        {reading === 0 && award && <ConfirmPanel grid={grid} replies={replies} items={items} decide={decide} onCompare={openCompare} />}
        {vendors}
      </aside>
    </div>
  )
}

const PANEL_TITLE = `${CARD_TITLE} px-[18px] pt-[18px] pb-3`

// ---- The award ----
function AwardCard({ grid, r, items, onAsk }: { grid: Grid; r: AwardResult; items: Item[]; onAsk: (q: string) => void }) {
  const per = perComma(grid.rfx)
  const total = moneyParts(r.total_cost)
  const missing = r.lines_without_an_eligible_price.length
  const vs = [...r.vendors_in_award].sort((a, b) => b.cost - a.cost)
  const top = vs.slice(0, 3)
  const more = vs.length - top.length
  // Names sit under their own segment when every segment is wide enough to hold one.
  const even = more > 0 || top.some((v) => v.share_pct < 22)
  const left = items.filter((x) => !x.cleared)
  const firm = r.unconfirmed_prices_used === 0 && left.length === 0
  const onlyRules = left.every((x) => x.kind === 'rule')
  const things = left.length === 0 ? '' : onlyRules ? (left.length === 1 ? 'a conversion' : `the ${left.length} conversions`) : left.length === 1 ? 'one thing' : `${left.length} things`
  const best = r.best_single_eligible_vendor
  const saving = r.saving_vs_reference

  return (
    <div className="glass card mt-9 px-[30px] max-sm:px-5 pt-7 pb-[26px]">
      <div className="text-base font-medium text-ink-2">
        Lowest award you can make, {missing ? `${r.lines_awarded} of ${r.lines_total}` : `all ${r.lines_awarded}`} lines{per}
      </div>
      <div className="flex items-baseline gap-2.5 mt-1.5">
        <span className="hero">{total.figure}</span>
        {total.unit && <span className="hero-unit text-ink-3">{total.unit}</span>}
      </div>
      {r.reference_cost_same_lines > 0 && Math.abs(saving) >= 1 && (
        <div className="mt-1 text-body text-ink-2">{saving > 0 ? <b className="font-semibold text-ok">{inrShort(saving)} under</b> : <>{inrShort(-saving)} over</>} {refWords(grid)}</div>
      )}

      <div className="mt-6">
        <div className="flex gap-[3px] h-2" role="img" aria-label={vs.map((v) => `${v.vendor} ${Math.round(v.share_pct)} percent`).join(', ')}>
          {vs.map((v, i) => (
            <i key={v.vendor_id} className={`rounded-[4px] ${i === 0 ? 'bg-accent' : 'bg-accent-2'}`} style={{ flex: Math.max(v.share_pct, 1.5) }} />
          ))}
        </div>
        <div className="grid gap-x-3 gap-y-2 mt-2.5 text-md" style={{ gridTemplateColumns: even ? `repeat(${top.length + (more > 0 ? 1 : 0)}, minmax(0, auto))` : top.map((v) => `minmax(0, ${v.share_pct}fr)`).join(' '), justifyContent: even ? 'start' : undefined, columnGap: even ? 28 : 3 }}>
          {top.map((v, i) => (
            <div key={v.vendor_id} className="min-w-0">
              <b className={`block font-semibold truncate ${i === 0 ? 'text-accent-ink' : 'text-accent-ink-2'}`}>{shortName(v.vendor)}</b>
              <span className="text-ink-3 max-sm:block">
                {v.lines} {plural(v.lines, 'line')} <span className="max-sm:hidden">· </span>
              </span>
              <span className={`${GOLD} max-sm:block`}>{v.cost_display}</span>
            </div>
          ))}
          {more > 0 && <div className="text-ink-3 self-center">+{more} more</div>}
        </div>
        {missing > 0 && (
          <div className="mt-3 text-md text-ink-2">
            {word(missing)} {plural(missing, 'line has', 'lines have')} no usable price from a vendor you can award.
          </div>
        )}
        {r.minimum_order_extra_cost > 0 && <div className="mt-3 text-md text-ink-3">Minimum orders add <b className={GOLD}>{inrShort(r.minimum_order_extra_cost)}</b> to this.</div>}
      </div>

      <div className={`strip flex items-center gap-3 mt-6 px-3.5 py-3 text-base ${firm ? 'ok' : ''}`} role="status">
        <span className="flex-none inline-flex items-center gap-[7px] h-[26px] px-[11px] rounded-full text-sm font-semibold bg-lift text-white before:size-1.5 before:rounded-full before:bg-current">{firm ? 'Firm' : 'Not firm yet'}</span>
        <span>
          {firm
            ? "Every price in this award is confirmed against the vendor's file."
            : left.length > 0
              ? `${r.unconfirmed_prices_used} of ${r.lines_awarded} prices rest on ${things} you haven't confirmed.`
              : `${r.unconfirmed_prices_used} of ${r.lines_awarded} prices are not confirmed yet. Open Compare to check them.`}
        </span>
      </div>

      <div className="mt-3.5 text-md text-ink-3">
        {best ? (
          <>
            One vendor instead: {shortName(best.vendor)} at <b className={GOLD}>{best.cost_display}</b>
            {best.extra_cost_vs_this_split >= 1 ? (
              <>
                , <b className={GOLD}>{inrShort(best.extra_cost_vs_this_split)}</b> more.
              </>
            ) : (
              ', the same total.'
            )}{' '}
            <button className={LINK} onClick={() => onAsk(`Compare the lowest award among vendors who cleared the quality gate with giving everything to ${best.vendor}. What do I gain and what do I give up?`)}>
              Compare the two
            </button>
          </>
        ) : (
          vs.length > 1 && 'No single vendor you can award has a usable price on every one of these lines.'
        )}
      </div>
    </div>
  )
}

// The award card while files are read: its shape, and one line saying when it fills.
function AwardSkeleton({ n }: { n: number }) {
  return (
    <div className="glass card mt-8 px-[30px] max-sm:px-5 py-7">
      <div aria-hidden="true">
        <div className="skeleton h-[18px] w-64 max-w-full" />
        <div className="skeleton h-[62px] w-52 max-w-full mt-3.5 !rounded-[12px]" />
        <div className="skeleton h-[18px] w-40 mt-3.5" />
        <div className="skeleton h-2 w-full mt-7" />
      </div>
      <p className="mt-[18px] text-base text-ink-2">The lowest award appears here once {n === 1 ? 'the reply is' : `all ${word(n).toLowerCase()} are`} read.</p>
    </div>
  )
}

// ---- To confirm ----
function ConfirmPanel({ grid, replies, items, decide, onCompare }: { grid: Grid; replies: Reply[]; items: ReturnType<typeof confirmItems>; decide: (fn: (d: Decisions) => Decisions) => void; onCompare: ReturnType<typeof useStore>['openCompare'] }) {
  const { tiles, rest, otherDoubts } = items
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [showRest, setShowRest] = useState(false)
  const box = useRef<HTMLElement>(null)
  const left = tiles.filter((x) => !x.cleared).length
  const restOpen = rest.filter((r) => !r.accepted)
  const blockedOnly = restOpen.every((r) => grid.vendors.find((v) => v.replyId === r.replyId)?.gate !== 'pass')

  const clear = (it: Item, applyDiscount = false) => {
    if (it.cleared) return
    if (it.kind === 'rule') decide((d) => (it.rule.choice ? chooseDiscount(d, it.rule.replyId, applyDiscount) : acceptRule(d, it.rule.id, true)))
    else decide((d) => it.cells.reduce((acc, c) => (c.check === 'look' ? confirmDoubts(acc, c.replyId, c.lineId, c.doubts.map((x) => x.code)) : acc), d))
  }
  const undo = (it: Item) => {
    if (!it.cleared) return
    if (it.kind === 'rule') decide((d) => (it.rule.choice ? chooseDiscount(d, it.rule.replyId, undefined) : acceptRule(d, it.rule.id, false)))
    else decide((d) => it.cells.reduce((acc, c) => (c.basis === 'edited' ? acc : unconfirmDoubts(acc, c.replyId, c.lineId)), d))
  }
  const acceptRest = (r: Rule, on: boolean, apply = false) => decide((d) => (r.choice ? chooseDiscount(d, r.replyId, on ? apply : undefined) : acceptRule(d, r.id, on)))

  // J and K move between tiles, A confirms the one in focus (or the first one still open), U undoes it.
  const live = useRef({ tiles, clear, undo })
  live.current = { tiles, clear, undo }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, dialog, [contenteditable], [popover]')) return
      const els = [...(box.current?.querySelectorAll<HTMLElement>('[data-tile]') ?? [])]
      if (els.length === 0) return
      const at = els.findIndex((el) => el.contains(document.activeElement))
      const { tiles, clear, undo } = live.current
      const k = e.key.toLowerCase()
      if (k === 'j' || k === 'k') els[Math.max(0, Math.min(els.length - 1, at < 0 ? 0 : at + (k === 'j' ? 1 : -1)))].focus()
      else if (k === 'a') {
        const it = at >= 0 ? tiles[at] : tiles.find((x) => !x.cleared)
        if (it) clear(it)
      } else if (k === 'u' && at >= 0) undo(tiles[at])
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <section ref={box} className="glass card p-2 pb-2.5" aria-label="To confirm">
      <h2 className={`${PANEL_TITLE} turn ${left ? 'text-stop' : 'text-ok'}`}>{left ? `${left} ${plural(left, 'thing')} to confirm before this is firm` : tiles.length ? 'Nothing left to confirm' : 'Nothing to confirm'}</h2>
      {tiles.length === 0 && <p className="px-[18px] pb-3 text-md text-ink-2">Every price in this award was quoted per unit in the RFx currency, and none needs a second look.</p>}
      {tiles.map((it) => (
        <Tile key={it.id} grid={grid} item={it} reply={replies.find((r) => r.id === it.vendor.replyId)} open={open.has(it.id)} onToggle={() => toggle(it.id)} onClear={(apply) => clear(it, apply)} onUndo={() => undo(it)} onCompare={onCompare} />
      ))}
      {rest.length > 0 && (
        <div className="px-[18px] pt-1.5 pb-2.5 text-sm leading-[22px] text-ink-3">
          {restOpen.length > 0
            ? `${restOpen.length} more ${plural(restOpen.length, 'conversion sits', 'conversions sit')} ${blockedOnly ? "on vendors you can't award" : 'on prices this award does not use'}.`
            : `${rest.length} other ${plural(rest.length, 'conversion is', 'conversions are')} confirmed.`}{' '}
          <button className={LINK} aria-expanded={showRest} onClick={() => setShowRest((x) => !x)}>
            {showRest ? 'Hide them' : 'Show them'}
          </button>
        </div>
      )}
      {showRest && (
        <ul className="mx-[18px] mb-2 border-t border-hair">
          {rest.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5 border-b border-hair">
              <div className="flex-1 min-w-0">
                <div className="text-md text-ink-2">{ruleTitle(r, shortName(r.vendorName), grid.lines.length)}</div>
                <div className="text-sm text-ink-3">
                  {r.lineIds.length} {plural(r.lineIds.length, 'line')}
                  {r.amount > 0 && ` · ${inrShort(r.amount)}`}
                </div>
              </div>
              {r.accepted ? (
                <>
                  <span className="text-sm font-medium text-ok whitespace-nowrap">{r.choice ? (r.choice.applied ? `${r.choice.percent}% applied` : 'List price kept') : 'Confirmed'}</span>
                  <Button size="sm" variant="ghost" onClick={() => acceptRest(r, false)}>
                    Undo
                  </Button>
                </>
              ) : r.choice ? (
                <>
                  <Button size="sm" onClick={() => acceptRest(r, true, false)}>
                    Keep list price
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => acceptRest(r, true, true)}>
                    Apply {r.choice.percent}%
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => acceptRest(r, true)}>
                  Confirm
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {otherDoubts > 0 && (
        <div className="px-[18px] pb-2.5 text-sm text-ink-3">
          {otherDoubts} {plural(otherDoubts, 'price')} this award does not use {plural(otherDoubts, 'needs', 'need')} a look.{' '}
          <button className={LINK} onClick={() => onCompare(null, 'flagged')}>
            Open {plural(otherDoubts, 'it', 'them')} in Compare
          </button>
        </div>
      )}
    </section>
  )
}

function Tile({ grid, item: it, reply, open, onToggle, onClear, onUndo, onCompare }: { grid: Grid; item: Item; reply?: Reply; open: boolean; onToggle: () => void; onClear: (applyDiscount?: boolean) => void; onUndo: () => void; onCompare: ReturnType<typeof useStore>['openCompare'] }) {
  const who = shortName(it.vendor.name)
  const rule = it.kind === 'rule' ? it.rule : null
  const cell = it.cell
  const nCells = it.kind === 'doubt' ? it.cells.length : 0
  const where = nCells === 1 ? it.line?.id : `${nCells} lines`
  const title = rule
    ? ruleTitle(rule, who, grid.lines.length)
    : it.kind === 'doubt' && it.cell.doubts.every((x) => x.code === 'substitute')
      ? `${who} offered a different item on ${where}`
      : `${who}: ${low(it.kind === 'doubt' ? it.cell.doubts.map((x) => DOUBT_TITLES[x.code]).join(', ') : '')} on ${where}`
  const did = rule ? ruleDid(rule) : it.kind === 'doubt' ? `${it.cell.doubts.map((x) => x.text).join(' ')}${nCells > 1 ? ` The same on ${it.cells.slice(1).map((c) => c.lineId).join(', ')}.` : ''}` : ''
  const steps = cell ? stepRows(cell.steps) : []
  const more = rule ? rule.lineIds.length - 1 : 0
  const one = nCells <= 1
  const quote = rule?.quote || cell?.quote || null
  const fileName = reply?.fileName ?? it.vendor.fileName
  const done = rule?.choice ? (rule.choice.applied ? `${rule.choice.percent}% applied` : 'List price kept') : 'Confirmed'

  return (
    <div
      data-tile
      tabIndex={0}
      className={`tile mx-2.5 mb-2.5 px-4 py-3.5 ${it.cleared ? 'ok' : ''}`}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.target !== e.currentTarget) return
        e.preventDefault()
        if (it.cleared) onUndo()
        else onClear()
      }}
    >
      <div className="grid grid-cols-[1fr_auto] gap-3.5 items-center">
        <div className="min-w-0">
          <div className="text-lg font-semibold tracking-[-0.01em]">{title}</div>
          <div className="text-md text-on-tile-2 mt-px">{did}</div>
        </div>
        {it.cleared ? (
          <Button variant="done" icon="check" aria-pressed="true" title="Click to undo" onClick={onUndo}>
            {done}
          </Button>
        ) : rule?.choice ? (
          <div className="flex flex-col gap-2 items-stretch">
            <Button variant="primary" onClick={() => onClear(false)}>
              Keep the list price
            </Button>
            <Button variant="outline" onClick={() => onClear(true)}>
              Apply the {rule.choice.percent}%
            </Button>
          </div>
        ) : (
          <Button variant="primary" onClick={() => onClear()}>
            Confirm
          </Button>
        )}
      </div>
      <button className={`${LINK_ON_TILE} mt-2 text-md`} aria-expanded={open} onClick={onToggle}>
        {open ? "Hide the vendor's words" : "See the vendor's words"}
      </button>
      <div className={`proof ${open ? 'open' : ''}`}>
        <div inert={!open}>
          <div className="mt-3">
            <Slip
              fileName={`${fileName}${it.line && !rule?.quote ? ` · ${it.line.id}` : ''}`}
              quote={quote}
              whole={rule?.code === 'reference'}
              find={rule?.choice ? [`${rule.choice.percent}%`, `${rule.choice.percent} %`] : [cell?.rawText, cell?.unitText]}
            />
          </div>
          {rule?.choice ? (
            <p className="mt-2 text-md text-on-tile-2">
              At list: <code className="font-mono text-sm text-white">{inrShort(rule.choice.listTotal)}</code>. With {rule.choice.percent}% off: <code className="font-mono text-sm text-white">{inrShort(rule.choice.discountedTotal)}</code>.
            </p>
          ) : (
            steps.length > 0 && (
              <p className="mt-2 text-md text-on-tile-2">
                {steps.map((s, i) => (
                  <span key={i} className="block">
                    {s.label && `${s.label}: `}
                    <code className="font-mono text-sm text-white">
                      {s.from}
                      {s.to ? ` = ${s.to}` : ''}
                    </code>
                  </span>
                ))}
                {more > 0 && (
                  <span className="block">
                    The same way on {more} more {plural(more, 'line')}.
                  </span>
                )}
              </p>
            )
          )}
          {it.line && (
            <button className={`${LINK_ON_TILE} mt-2 text-md`} onClick={() => onCompare({ kind: 'cell', replyId: it.vendor.replyId, lineId: it.line!.id, edit: it.kind === 'doubt' })}>
              {it.kind === 'doubt' ? (one ? 'It is wrong. Correct it in Compare' : 'Check each one in Compare') : 'Open the file in Compare'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Vendors ----
// Seconds since a file started being read, ticking once a second.
function Ticking({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return <>{Math.max(0, Math.round((Date.now() - since) / 1000))} s</>
}

const GROUP = "flex items-center gap-[9px] mx-[18px] mb-0.5 text-lg font-semibold tracking-[-0.01em] before:size-2 before:rounded-full before:bg-current"

function Vendors({ grid, replies, ready, reading, onVendor, onRetry }: { grid: Grid; replies: Reply[]; ready: boolean; reading: boolean; onVendor: (replyId: string) => void; onRetry: (replyId: string) => void }) {
  const started = useRef(new Map<string, number>())
  for (const r of replies) {
    if (r.status === 'extracting' && !started.current.has(r.id)) started.current.set(r.id, Date.now())
    if (r.status !== 'extracting') started.current.delete(r.id)
  }
  const shared = grid.commonLineIds.length
  const N = grid.vendors.length
  const per = perComma(grid.rfx)
  const unit = moneyUnit(grid.vendors.map((v) => (shared ? v.likeForLike : v.costQuoted)))
  // Cheapest first on shared lines. With none, the vendor that covers most of the list first.
  const order = (a: VendorSummary, b: VendorSummary) => (shared ? (a.likeForLike ?? 0) - (b.likeForLike ?? 0) : b.linesQuoted - a.linesQuoted)
  const ok = grid.vendors.filter(canAward).sort(order)
  const no = grid.vendors.filter((v) => !canAward(v)).sort(order)
  const pending = replies.filter((r) => !grid.vendors.some((v) => v.replyId === r.id))
  const ref = shared ? referenceTotal(grid) : 0

  const row = (v: VendorSummary, can: boolean) => (
    <button key={v.replyId} className="vrow grid grid-cols-[1fr_auto] gap-x-4 gap-y-px items-center w-full text-left py-[11px] pr-[18px] pl-[35px] rounded-[14px] hover:bg-well" onClick={() => onVendor(v.replyId)} title="Open this vendor in Compare">
      <span className={`text-base font-medium tracking-[-0.005em] ${can ? '' : 'text-dim'}`}>{shortName(v.name)}</span>
      <span className={`row-span-2 col-start-2 text-lg text-right ${can ? '' : 'text-dim'}`}>
        {!shared && (
          <span className="text-sm text-ink-3 mr-2.5">
            {v.linesQuoted} of {v.totalLines} lines
          </span>
        )}
        {v.linesQuoted > 0 ? <Money value={shared ? v.likeForLike : v.costQuoted} unit={unit} tone={can ? 'white' : 'dim'} /> : null}
      </span>
      <span className={`col-start-1 text-sm line-clamp-2 ${can ? 'text-ok-2' : 'text-stop-2'}`}>{reason(grid, v)}</span>
    </button>
  )

  return (
    <section className="glass card p-2 pb-2.5" aria-label="Vendors">
      <h2 className={`${PANEL_TITLE} !pb-[15px] flex justify-between items-baseline gap-4`}>
        Vendors
        {N > 0 && <span className="text-sm font-normal tracking-normal text-ink-3 text-right">{shared ? `on the ${shared} lines ${N === 1 ? 'it' : `all ${word(N).toLowerCase()}`} quoted${per}` : `on the lines each one priced${per}`}</span>}
      </h2>
      {/* While files are still being read there is one group, in the order they landed. */}
      {reading && N > 0 && (
        <>
          <div className={`${GROUP} mt-1 text-ok`}>Read</div>
          {grid.vendors.map((v) => row(v, canAward(v)))}
        </>
      )}
      {!reading && ok.length > 0 && (
        <>
          <div className={`${GROUP} mt-1 text-ok`}>Can award</div>
          {ok.map((v) => row(v, true))}
        </>
      )}
      {!reading && no.length > 0 && (
        <>
          <div className={`${GROUP} text-stop ${ok.length ? 'mt-[18px]' : 'mt-1'}`}>Can't award yet</div>
          {no.map((v) => row(v, false))}
        </>
      )}
      {pending.length > 0 && (
        <>
          <div className={`${GROUP} text-sky ${N ? 'mt-[18px]' : 'mt-1'}`}>{reading ? 'Being read' : 'Not read yet'}</div>
          {pending.map((r) =>
            r.status === 'error' ? (
              <div key={r.id} className="vrow py-[11px] pr-[18px] pl-[35px]">
                <div className="text-base font-medium text-ink-2 mb-2">{shortName(r.vendorName)}</div>
                <ErrorTile title="This file could not be read" text={r.error}>
                  <Button variant="primary" onClick={() => onRetry(r.id)}>
                    Try again
                  </Button>
                </ErrorTile>
              </div>
            ) : (
            <div key={r.id} className="vrow grid grid-cols-[1fr_auto] gap-x-4 gap-y-px items-center py-[11px] pr-[18px] pl-[35px]">
              <span className="text-base font-medium text-ink-2">{shortName(r.vendorName)}</span>
              <span className="row-span-2 col-start-2">
                <span className={`block h-5 w-[92px] ${r.status === 'extracting' ? 'skeleton' : 'rounded-lg bg-well'}`} />
              </span>
              <span className="col-start-1 text-sm text-ink-3" role={r.status === 'extracting' ? 'status' : undefined}>
                {r.status === 'extracting' ? (
                  <>
                    Reading, <Ticking since={started.current.get(r.id) ?? Date.now()} />
                  </>
                ) : (
                  'Waiting'
                )}
              </span>
            </div>
            ),
          )}
        </>
      )}
      {ready && ref > 0 && (
        <div className="text-sm text-ink-3 py-2.5 pr-[18px] pl-[35px]">
          {cap(grid.rfx.refLabel)}, same {shared} lines: <b className={GOLD}>{inrShort(ref, unit)}</b>
        </div>
      )}
    </section>
  )
}
