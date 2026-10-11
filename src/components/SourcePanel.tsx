import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { acceptRule, chooseDiscount, confirmDoubts, setOverride, unconfirmDoubts } from '../lib/decisions.ts'
import { moneyUnit, perPeriod, price, standing } from '../lib/normalize.ts'
import type { Cell, Decisions, Reply, VendorSummary } from '../lib/types.ts'
import { useStore } from '../store.tsx'
import { DocView } from './DocView.tsx'
import { Button, CARD_TITLE, CODE, Dialog, GOLD, Money, Sect, Slip, Work, stepRows } from './ui.tsx'

// A glass sheet fixed to the right edge, with no scrim, so the grid stays readable beside it.
// It mounts once per open and its content swaps in place, so walking the grid with the arrow
// keys never pulls focus out of the grid. Esc and the close button dismiss it the same way.
function Panel({ label, top, title, reply, onClose, foot, children }: { label: string; top: ReactNode; title: ReactNode; reply: Reply; onClose: () => void; foot?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const [file, setFile] = useState(false)
  // Focus goes in only when the sheet opens, and only if the keyboard is not already at work in the grid.
  useEffect(() => {
    if (!(document.activeElement instanceof HTMLElement) || !document.activeElement.classList.contains('cell')) ref.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('dialog, [popover]')) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <aside ref={ref} role="region" aria-label={label} tabIndex={-1} className="glass side card fixed z-30 top-3.5 right-3.5 bottom-3.5 w-[min(460px,calc(100%-28px))] pt-[26px] px-[26px] pb-[22px] overflow-auto flex flex-col text-base text-ink-2 focus-visible:outline-none">
      <button onClick={onClose} aria-label="Close (Esc)" className="btn absolute top-[18px] right-[18px] size-8 grid place-items-center rounded-[10px] text-ink-2 hover:bg-well hover:text-ink">
        <svg viewBox="0 0 14 14" className="size-3.5 fill-none stroke-current" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
      <div className="text-md font-medium text-ink-3 pr-10">{top}</div>
      <h2 className={`${CARD_TITLE} mt-1.5`}>{title}</h2>
      {children}
      <div className="mt-auto pt-5 flex items-center gap-2">
        <Button onClick={() => setFile(true)}>Open the file</Button>
        {foot}
      </div>
      <Dialog open={file} onClose={() => setFile(false)} title={`${reply.vendorName}: ${reply.fileName}`} wide>
        {file && <DocView reply={reply} tall />}
      </Dialog>
    </aside>
  )
}

const LAB = 'mt-6 mb-2'

export function SourcePanel({
  cell,
  vendor,
  reply,
  walk,
  edit: wantEdit,
  onGo,
  onClose,
}: {
  cell: Cell
  vendor: VendorSummary
  reply: Reply
  walk: { replyId: string; lineId: string }[]
  // Opened to correct the price: show the box and put the cursor in it.
  edit: boolean
  onGo: (replyId: string, lineId: string) => void
  onClose: () => void
}) {
  const { set, grid } = useStore()
  const line = grid.lines.find((l) => l.id === cell.lineId)!
  const [edit, setEdit] = useState('')
  const [fixing, setFixing] = useState(wantEdit)
  const input = useRef<HTMLInputElement>(null)
  const openDoubts = cell.doubts.filter((r) => !r.confirmed)
  const rules = grid.rules.filter((r) => cell.ruleIds.includes(r.id) && r.code !== 'vendor_attribute')
  const openRules = rules.filter((r) => !r.accepted)
  const choice = openRules.find((r) => r.choice)
  const at = walk.findIndex((w) => w.replyId === cell.replyId && w.lineId === cell.lineId)
  const attrs = grid.rfx.attributes.filter((a) => cell.attributes[a.key])
  const per = perPeriod(grid.rfx)
  const decide = (fn: (d: Decisions) => Decisions) => set((s) => ({ ...s, decisions: fn(s.decisions) }))

  // A different cell: clear the box. Asked to correct: show it.
  useEffect(() => {
    setEdit('')
    setFixing(wantEdit)
  }, [cell.replyId, cell.lineId, wantEdit])
  useEffect(() => {
    if (fixing) input.current?.focus()
  }, [fixing, cell.replyId, cell.lineId])

  const saveEdit = () => {
    const n = Number(edit)
    if (!Number.isFinite(n) || n <= 0) return
    decide((d) => setOverride(d, cell.replyId, cell.lineId, n))
    setEdit('')
    setFixing(false)
  }
  const step = (d: number) => {
    const w = walk[at + d]
    if (w) onGo(w.replyId, w.lineId)
  }
  // Confirm clears everything this price rests on: the vendor's open conversions and any doubt on the cell.
  const confirm = (applyDiscount = false) =>
    decide((d) => {
      let next = d
      for (const r of openRules) next = r.choice ? chooseDiscount(next, r.replyId, applyDiscount) : acceptRule(next, r.id, true)
      if (openDoubts.length && cell.unitPrice != null) next = confirmDoubts(next, cell.replyId, cell.lineId, cell.doubts.map((r) => r.code))
      return next
    })
  const undo = () =>
    decide((d) => {
      let next = cell.basis === 'edited' ? setOverride(d, cell.replyId, cell.lineId, null) : d
      for (const r of rules) next = r.choice ? chooseDiscount(next, r.replyId, undefined) : acceptRule(next, r.id, false)
      if (cell.doubts.length) next = unconfirmDoubts(next, cell.replyId, cell.lineId)
      return next
    })

  const open = cell.unitPrice != null && (openRules.length > 0 || openDoubts.length > 0)
  const cleared = !open && cell.unitPrice != null && (rules.length > 0 || cell.doubts.length > 0 || cell.basis === 'edited')
  const covers = Math.max(0, ...openRules.map((r) => r.lineIds.length))
  const why = [...openRules.map((r) => `${r.title}.`), ...openDoubts.map((r) => r.text)].join(' ')
  const steps = stepRows(cell.steps)

  return (
    <Panel
      label={`Source for ${vendor.name}, ${line.id}`}
      top={
        <>
          <span className={CODE}>{line.id}</span> · {line.spec ?? line.description}
        </>
      }
      title={vendor.name}
      reply={reply}
      onClose={onClose}
      foot={
        at >= 0 && (
          <div className="ml-auto flex items-center gap-1" title="Walk everything still to confirm">
            <Button variant="ghost" icon="back" className="!px-2.5" disabled={at === 0} onClick={() => step(-1)} aria-label="Previous price to confirm" />
            <span className="text-sm text-ink-3 whitespace-nowrap">
              {at + 1} of {walk.length}
            </span>
            <Button variant="ghost" icon="chevron" className="!px-2.5" disabled={at === walk.length - 1} onClick={() => step(1)} aria-label="Next price to confirm" />
          </div>
        )
      }
    >
      <div className="mt-3.5 text-fig font-semibold tracking-[-0.024em] text-gold">
        {cell.unitPrice != null ? price(cell.unitPrice) : <span className="text-ink-3">{cell.check === 'not_quoted' ? 'Not quoted' : 'No price'}</span>}
        {cell.unitPrice != null && <small className="ml-2 text-lg font-medium tracking-normal text-ink-3">a {line.unit}</small>}
      </div>
      {cell.lineCost != null && (
        <div className="mt-1 text-sm text-ink-3">
          On this line{per}: <Money value={cell.lineCost} />
        </div>
      )}
      {cell.check === 'not_quoted' && <p className="mt-3">This vendor gave no price for this line, and nothing in their reply points to one. It is left empty on purpose.</p>}

      {cell.check !== 'not_quoted' && (
        <>
          <Sect className={LAB}>The vendor's words</Sect>
          <Slip fileName={reply.fileName} quote={cell.quote} find={[cell.rawText, cell.unitText]} whole={cell.basis === 'assumed'} />
          {cell.vendorLabel && <div className="text-sm text-ink-3 mt-2">Vendor's item: {cell.vendorLabel}</div>}
          {cell.offered && cell.match !== 'exact' && <div className="text-sm text-stop mt-1">Offered in place of what was asked: {cell.offered}</div>}
        </>
      )}

      {(steps.length > 0 || line.refPrice != null) && cell.check !== 'not_quoted' && (
        <>
          <Sect className={LAB}>How code worked it out</Sect>
          <Work rows={steps} />
          {line.refPrice != null && (
            <div className={`flex justify-between gap-4 py-[9px] ${steps.length ? 'border-t border-hair' : ''}`}>
              <span className="first-letter:uppercase">{grid.rfx.refLabel}</span>
              <b className="font-semibold text-ink">{price(line.refPrice)}</b>
            </div>
          )}
        </>
      )}

      {/* The one thing that needs the buyer here. Red while it is open, green once it is done. */}
      {(open || cell.check === 'no_price') && (
        <div className="tile mt-6 px-4 py-3.5">
          <div className="text-lg font-semibold">{cell.check === 'no_price' ? 'No usable price' : 'Not confirmed yet'}</div>
          <div className="mt-px text-md text-on-tile-2">
            {cell.check === 'no_price' ? cell.doubts.map((r) => r.text).join(' ') || 'The reader could not find a price it could use.' : why}
            {covers > 1 && ` Confirming covers ${covers === grid.lines.length ? `all ${covers}` : covers} of their lines.`}
          </div>
          <div className="mt-3 flex gap-2 flex-wrap">
            {open &&
              (choice?.choice ? (
                <>
                  <Button variant="primary" onClick={() => confirm(false)}>
                    Keep the list price
                  </Button>
                  <Button variant="outline" onClick={() => confirm(true)}>
                    Apply the {choice.choice.percent}%
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => confirm()}>
                  Confirm
                </Button>
              ))}
            <Button variant={open ? 'outline' : 'primary'} onClick={() => setFixing(true)}>
              {open ? "It's wrong" : 'Type the price'}
            </Button>
          </div>
        </div>
      )}
      {cleared && (
        <div className="tile ok mt-6 px-4 py-3.5">
          <div className="text-lg font-semibold">{cell.basis === 'edited' ? 'You typed this price' : 'Confirmed'}</div>
          <div className="mt-px text-md text-on-tile-2">{cell.basis === 'edited' ? 'It replaces what the reader took from the file.' : [...rules.map((r) => `${r.title}.`), ...cell.doubts.map((r) => r.text)].join(' ')}</div>
          <div className="mt-3 flex gap-2 flex-wrap">
            <Button variant="outline" onClick={undo}>
              {cell.basis === 'edited' ? 'Go back to the extracted value' : 'Undo'}
            </Button>
            {cell.basis !== 'edited' && (
              <Button variant="outline" onClick={() => setFixing(true)}>
                It's wrong
              </Button>
            )}
          </div>
        </div>
      )}

      {fixing && (
        <div className="mt-4">
          <label className="block text-sm font-medium text-ink-3 mb-1.5" htmlFor="edit-price">
            The right price, in rupees per {line.unit}
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={input}
              id="edit-price"
              className="h-11 flex-1 min-w-0 rounded-[12px] px-3.5 bg-slip border border-hair-2 text-ink outline-none focus:border-accent placeholder:text-ink-3"
              placeholder="₹"
              inputMode="decimal"
              value={edit}
              onChange={(e) => setEdit(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
            />
            <Button size="lg" disabled={!edit.trim()} onClick={saveEdit}>
              Use my value
            </Button>
          </div>
        </div>
      )}

      {(attrs.length > 0 || cell.addons.length > 0 || cell.tiers.length > 0 || cell.capacity != null || cell.moq != null) && (
        <>
          <Sect className={LAB}>Beside the price</Sect>
          <dl className="rows">
            {attrs.map((a) => {
              const v = cell.attributes[a.key]
              return (
                <Row key={a.key} label={a.label} title={v.quote}>
                  {v.num != null ? `${v.num}${a.unit ? ` ${a.unit}` : ''}` : v.text}
                  {v.vendorWide && <span className="block text-sm font-normal text-ink-3">stated once for the whole quote</span>}
                </Row>
              )
            })}
            {cell.moq != null && (
              <Row label="Minimum order">
                {cell.moq.toLocaleString('en-IN')} {line.unit}
                <span className="block text-sm font-normal text-ink-3">
                  against {line.quantity.toLocaleString('en-IN')} needed{per}
                </span>
              </Row>
            )}
            {cell.capacity != null && (
              <Row label="Supply limit">
                {cell.capacity.toLocaleString('en-IN')} {line.unit}s{per}
                <span className="block text-sm font-normal text-ink-3">against {line.quantity.toLocaleString('en-IN')} asked</span>
              </Row>
            )}
            {cell.addons.map((a) => (
              <Row key={a.key} label={`Add-on: ${a.label}`}>
                <span className={GOLD}>{price(a.unitPrice)}</span> more
                <span className="block text-sm font-normal text-ink-3">not in the price above</span>
              </Row>
            ))}
            {cell.tiers.length > 0 && <Row label="By quantity">{cell.tiers.map((t) => `${t.minQty.toLocaleString('en-IN')}+: ${price(t.unitPrice)}`).join('  ·  ')}</Row>}
          </dl>
        </>
      )}
    </Panel>
  )
}

const Row = ({ label, title, children }: { label: string; title?: string; children: ReactNode }) => (
  <div className="flex justify-between gap-4 py-[9px]" title={title}>
    <dt className="text-ink-2">{label}</dt>
    <dd className="text-right font-semibold text-ink">{children}</dd>
  </div>
)

// One vendor: where it stands, its totals, the conversions code applied, unmatched items and notes.
export function VendorPanel({ vendor: v, reply, onClose }: { vendor: VendorSummary; reply: Reply; onClose: () => void }) {
  const { grid } = useStore()
  const per = perPeriod(grid.rfx)
  const blockers = grid.blockers.filter((b) => b.replyId === v.replyId)
  const rules = grid.rules.filter((r) => r.replyId === v.replyId && r.code !== 'vendor_attribute')
  const st = standing(grid, v)
  const unit = moneyUnit([v.costQuoted])
  const ok = v.gate === 'pass'
  return (
    <Panel label={`Vendor ${v.name}`} top={<span className="font-mono text-sm font-normal text-lilac-2">{v.fileName}</span>} title={v.name} reply={reply} onClose={onClose}>
      <div className={`mt-1 text-sm font-medium ${st.tone === 'none' ? 'text-ok' : 'text-stop'}`}>{st.long}</div>
      <dl className="rows mt-4">
        <Row label="Lines priced">
          {v.linesQuoted} of {v.totalLines}
        </Row>
        {v.likeForLike != null && (
          <Row label={`${grid.commonLineIds.length} shared lines${per}`}>
            <Money value={v.likeForLike} unit={unit} tone={ok ? 'white' : 'dim'} />
          </Row>
        )}
        <Row label={`Lines it priced${per}`}>
          <Money value={v.costQuoted} unit={unit} />
          {v.linesQuoted < v.totalLines && <span className="block text-sm font-normal text-ink-3">not comparable: {v.linesQuoted} lines, not {v.totalLines}</span>}
        </Row>
        <Row label="Read by">
          <span className="font-normal text-ink-2">{v.readBy || 'not recorded'}</span>
        </Row>
      </dl>

      {blockers.length > 0 && (
        <>
          <Sect className={LAB}>Stops an award</Sect>
          <ul className="space-y-2.5">
            {blockers.map((b) => (
              <li key={b.id}>
                <div className={`font-semibold ${b.kind === 'gate' || b.kind === 'no_answers' ? 'text-stop' : 'text-ink'}`}>{b.title}</div>
                <div className="text-md">{b.text}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      {rules.length > 0 && (
        <>
          <Sect className={LAB}>Conversions code applied</Sect>
          <ul className="rows">
            {rules.map((r) => (
              <li key={r.id} className="flex justify-between gap-4 py-[9px]">
                <span className="text-ink">
                  {r.title} <span className="text-ink-3">· {r.lineIds.length} lines</span>
                </span>
                <span className={`text-sm font-medium whitespace-nowrap ${r.accepted ? 'text-ok' : 'text-stop'}`}>{r.accepted ? 'Confirmed' : 'Not confirmed'}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {v.unmatched.length > 0 && (
        <>
          <Sect className={LAB}>Quoted, but not matched to a line</Sect>
          <ul className="space-y-1.5 text-md">
            {v.unmatched.map((u, i) => (
              <li key={i}>
                "{u.vendor_item_label}" at {u.price_text} {u.unit_text}. {u.note}
              </li>
            ))}
          </ul>
        </>
      )}

      {v.notes.length > 0 && (
        <>
          <Sect className={LAB}>Reader's notes on this file</Sect>
          <ul className="space-y-1.5 text-md list-disc pl-5">
            {v.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

// One answer to one question: what the vendor wrote, and how the reader judged a gate question.
export function AnswerPanel({ vendor: v, reply, questionId, onClose }: { vendor: VendorSummary; reply: Reply; questionId: string; onClose: () => void }) {
  const { grid } = useStore()
  const q = grid.questionnaire.find((x) => x.id === questionId)
  const a = v.answers[questionId]
  if (!q) return null
  const m = a?.meets_requirement
  return (
    <Panel
      label={`${v.name}, ${q.id}`}
      top={
        <>
          <span className={CODE}>{q.id}</span>
          {q.gate && ' · quality gate'}
        </>
      }
      title={v.name}
      reply={reply}
      onClose={onClose}
    >
      <p className="mt-3 text-ink">{q.text}</p>
      {q.gate && a?.answered && <div className={`mt-4 text-lg font-semibold ${m === 'yes' ? 'text-ok' : 'text-stop'}`}>{m === 'yes' ? 'Meets it' : m === 'no' ? 'Does not meet it' : 'Unclear'}</div>}
      <Sect className={LAB}>The vendor's words</Sect>
      <Slip fileName={reply.fileName} quote={a?.quote ?? a?.answer ?? null} empty="Nothing in this file answers the question." />
      {a?.answer && a.quote && a.answer !== a.quote && (
        <>
          <Sect className={LAB}>As the reader recorded it</Sect>
          <p className="text-ink">{a.answer}</p>
        </>
      )}
    </Panel>
  )
}
