import { useMemo } from 'react'
import { exportGrid } from '../lib/exportXlsx.ts'
import { isUnconfirmed, lineCategory, moneyUnit, perPeriod, price, r2, shortName } from '../lib/normalize.ts'
import type { Cell, Grid, LineItem, VendorSummary } from '../lib/types.ts'
import { useStore } from '../store.tsx'
import type { Filter, PricesView, Sel } from '../store.tsx'
import { Button, CODE, Icon, MENU, MENU_ITEM, Money, Seg, useMenu, word } from './ui.tsx'

const matches = (c: Cell, f: Filter) =>
  f === 'all' || (f === 'flagged' && (c.check === 'look' || c.check === 'no_price')) || (f === 'missing' && c.unitPrice == null) || (f === 'converted' && (c.basis === 'converted' || c.basis === 'assumed'))

// A vendor can be awarded once it is through the quality gate. The same rule as Decide.
export const awardableIds = (grid: Grid) => new Set(grid.vendors.filter((v) => v.gate === 'pass').map((v) => v.replyId))

// Lowest price per line, only among vendors who can be awarded.
function lowestByLine(grid: Grid, awardable: Set<string>) {
  const m: Record<string, number> = {}
  for (const l of grid.lines) {
    const ps = grid.vendors.filter((v) => awardable.has(v.replyId)).map((v) => grid.cells[v.replyId][l.id].unitPrice).filter((p): p is number => p != null)
    if (ps.length > 1) m[l.id] = Math.min(...ps)
  }
  return m
}

// A green or red word under a vendor's name in a column head. The same words on both tables.
export function headWord(grid: Grid, v: VendorSummary): { text: string; tone: 'ok' | 'stop' | 'none' } {
  if (!grid.questionnaire.some((q) => q.gate)) return { text: `${v.linesQuoted} of ${v.totalLines} lines`, tone: 'none' }
  if (v.gate === 'pass') return { text: 'Can award', tone: 'ok' }
  return { text: v.gate === 'fail' ? 'Failed gate' : v.gate === 'not_answered' ? 'No questionnaire' : 'Gate unclear', tone: 'stop' }
}

// What the marks in the grid mean: three items, on the row with the Prices switch.
export function PricesKey() {
  const { grid } = useStore()
  const sample = useMemo(() => {
    const awardable = awardableIds(grid)
    const lowest = lowestByLine(grid, awardable)
    const id = grid.lines.find((l) => lowest[l.id] != null)?.id
    return { low: id ? lowest[id] : null, anyOut: awardable.size < grid.vendors.length, anyOpen: grid.vendors.some((v) => grid.lines.some((l) => isUnconfirmed(grid.cells[v.replyId][l.id]))) }
  }, [grid])
  return (
    <div className="lg:ml-auto flex gap-x-[18px] gap-y-1 flex-wrap text-sm text-ink-3">
      {sample.low != null && (
        <span>
          <b className="font-semibold text-ink mr-1.5">{price(sample.low)}</b>lowest you can award
        </span>
      )}
      {sample.anyOpen && (
        <span>
          <i className="udot mr-1.5 align-[2px]" />
          not confirmed yet
        </span>
      )}
      {sample.anyOut && <span>Grey: vendor can't be awarded</span>}
    </div>
  )
}

// Filters, what each cell shows, and the export menu. One row above the grid.
export function PricesBar({ view, setView }: { view: PricesView; setView: (v: PricesView) => void }) {
  const { state, grid } = useStore()
  const menu = useMenu()
  const hasRef = grid.lines.some((l) => l.refPrice != null)
  const count = (f: Filter) => grid.vendors.reduce((n, v) => n + grid.lines.filter((l) => matches(grid.cells[v.replyId][l.id], f)).length, 0)
  return (
    <div className="flex items-center gap-x-3.5 gap-y-2.5 flex-wrap mt-3">
      <Seg
        small
        label="Filter cells"
        value={view.filter}
        onChange={(f) => setView({ ...view, filter: f })}
        options={[
          { id: 'all', label: 'All' },
          { id: 'flagged', label: 'Flagged', count: count('flagged'), need: true },
          { id: 'missing', label: 'Missing', count: count('missing') },
          { id: 'converted', label: 'Converted', count: count('converted') },
        ]}
      />
      <span className="text-sm text-ink-3 lg:ml-auto">Show</span>
      <Seg
        small
        label="What each cell shows"
        value={view.mode}
        onChange={(m) => setView({ ...view, mode: m })}
        options={[{ id: 'price', label: 'Price' }, ...(hasRef ? [{ id: 'pct', label: `% against ${grid.rfx.refLabel}` }] : []), ...grid.rfx.attributes.map((a) => ({ id: a.key, label: a.label }))]}
      />
      <Button ref={menu.btn} popoverTarget="export-menu" onClick={() => menu.place('right')}>
        Export
      </Button>
      <div ref={menu.pop} id="export-menu" popover="auto" className={MENU}>
        <button className={MENU_ITEM} onClick={() => (exportGrid(grid), menu.close())}>
          Comparison (XLSX)
        </button>
        <a className={MENU_ITEM} download="extractions.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(state.replies))}`} title="Raw model output for each document, for checking" onClick={menu.close}>
          Extraction JSON
        </a>
      </div>
    </div>
  )
}

const FILTER_EMPTY: Record<Filter, string> = { all: '', flagged: 'No price needs a second look.', missing: 'No lines are missing a price.', converted: 'No price was converted.' }

// The grid, on the page's one card. Prices are gold, the lowest you can award on a line is white,
// a red dot follows a price that is not confirmed, and a vendor you can't award is grey.
export function PricesGrid({ view, setView, sel, onSelect, onVendor }: { view: PricesView; setView: (v: PricesView) => void; sel: Sel; onSelect: (replyId: string, lineId: string) => void; onVendor: (replyId: string) => void }) {
  const { grid } = useStore()
  const { filter, mode } = view
  const asPct = mode === 'pct'
  const attrDef = grid.rfx.attributes.find((a) => a.key === mode)
  const hasRef = grid.lines.some((l) => l.refPrice != null)
  const per = perPeriod(grid.rfx)
  const awardable = useMemo(() => awardableIds(grid), [grid])
  const lowest = useMemo(() => lowestByLine(grid, awardable), [grid, awardable])
  const shared = grid.commonLineIds.length

  const cats = useMemo(() => [...new Set(grid.lines.map(lineCategory))], [grid])
  const visible = (l: LineItem) => filter === 'all' || grid.vendors.some((v) => matches(grid.cells[v.replyId][l.id], filter))
  const isOpen = (cat: string) => filter !== 'all' || !view.closed.includes(cat)
  const toggle = (cat: string) => setView({ ...view, closed: view.closed.includes(cat) ? view.closed.filter((c) => c !== cat) : [...view.closed, cat] })
  const shownLines = grid.lines.filter((l) => isOpen(lineCategory(l)) && visible(l))

  // Arrow keys move between cells. If the source sheet is open it follows, without taking focus.
  function onKey(e: React.KeyboardEvent, li: number, vi: number) {
    const d = e.key === 'ArrowDown' ? [1, 0] : e.key === 'ArrowUp' ? [-1, 0] : e.key === 'ArrowRight' ? [0, 1] : e.key === 'ArrowLeft' ? [0, -1] : null
    if (!d) return
    const l = shownLines[li + d[0]]
    const v = grid.vendors[vi + d[1]]
    if (!l || !v) return
    e.preventDefault()
    document.getElementById(`cell-${v.replyId}-${l.id}`)?.focus()
    if (sel?.kind === 'cell') onSelect(v.replyId, l.id)
  }

  if (filter !== 'all' && shownLines.length === 0) {
    return (
      <div className="mt-6 pt-6 border-t border-hair">
        <h2 className="text-xl font-semibold tracking-[-0.018em] text-ink">{FILTER_EMPTY[filter]}</h2>
        <p className="mt-1.5 text-lg font-normal text-ink-2">Nothing in the {grid.lines.length} lines matches this filter.</p>
        <Button size="lg" className="mt-[18px]" onClick={() => setView({ ...view, filter: 'all' })}>
          Show all lines
        </Button>
      </div>
    )
  }

  // One unit for every total in the head, and one for every subtotal in the body.
  const headUnit = moneyUnit(grid.vendors.map((v) => (shared ? v.likeForLike : v.costQuoted)))
  const subtotals = cats.flatMap((cat) => {
    const lines = grid.lines.filter((l) => lineCategory(l) === cat)
    return grid.vendors.map((v) => lines.reduce((s, l) => s + (grid.cells[v.replyId][l.id].lineCost ?? 0), 0))
  })
  const subUnit = moneyUnit(subtotals) === 'rupee' ? 'rupee' : 'lakh'
  const subDigits = subtotals.some((x) => x > 0 && x < 1e6) ? 1 : 0
  // The head stays put while the lines scroll, so it is solid.
  const th = 'sticky top-0 z-20 bg-glass-solid pl-[18px] pb-3 pt-2 align-bottom font-medium text-sm text-ink-3 text-right border-b border-hair-2'
  const cols = 3 + (hasRef ? 1 : 0) + grid.vendors.length

  return (
    <div className="mt-4 overflow-auto max-h-[calc(100dvh-104px)]">
      <table className="w-full min-w-[980px] border-separate border-spacing-0 text-base">
        <thead>
          <tr>
            <th className={`${th} !text-left !pl-0 w-12`}>Line</th>
            <th className={`${th} !text-left !pl-0`}>{grid.lines.some((l) => l.spec) ? 'Size' : 'Description'}</th>
            <th className={`${th} whitespace-normal max-w-24`}>{grid.rfx.quantityLabel}</th>
            {hasRef && <th className={`${th} first-letter:uppercase whitespace-nowrap`}>{grid.rfx.refLabel}</th>}
            {grid.vendors.map((v) => {
              const ok = awardable.has(v.replyId)
              const hw = headWord(grid, v)
              return (
                <th key={v.replyId} className={`${th} min-w-[118px]`}>
                  <button className={`block ml-auto text-lg font-semibold tracking-[-0.012em] rounded hover:underline underline-offset-[3px] text-right max-w-36 ${ok ? 'text-ink' : 'text-ink-3'}`} onClick={() => onVendor(v.replyId)} title={v.name}>
                    {shortName(v.name)}
                  </button>
                  {v.linesQuoted > 0 ? <Money value={shared ? v.likeForLike : v.costQuoted} unit={headUnit} tone={ok ? 'gold' : 'grey'} className="block text-lg !font-semibold" /> : <span className="block text-lg font-normal text-ink-3">no prices</span>}
                  <span className={`block whitespace-nowrap ${hw.tone === 'ok' ? 'text-ok' : hw.tone === 'stop' ? 'text-stop' : 'text-ink-3'}`}>{hw.text}</span>
                  {!shared && hw.tone !== 'none' && (
                    <span className="block whitespace-nowrap font-normal">
                      {v.linesQuoted} of {v.totalLines} lines
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {cats.map((cat) => {
            const lines = grid.lines.filter((l) => lineCategory(l) === cat)
            const rows = lines.filter(visible)
            if (filter !== 'all' && rows.length === 0) return null
            const open = isOpen(cat)
            const gtd = 'pt-4 pb-[11px] pl-[18px] border-b border-hair text-right whitespace-nowrap'
            return [
              <tr key={`g-${cat}`}>
                <td className={`${gtd} !pl-0`} />
                <td className={`${gtd} !pl-0 !text-left !whitespace-normal`} colSpan={2}>
                  <button className="inline-flex items-baseline gap-2 rounded text-left font-semibold text-sky whitespace-nowrap" aria-expanded={open} onClick={() => toggle(cat)} disabled={filter !== 'all'}>
                    {cat}
                    <span className="text-sm font-normal text-ink-3">
                      {lines.length} line{lines.length > 1 ? 's' : ''}, subtotal{per}
                    </span>
                    <Icon name={open ? 'down' : 'chevron'} className="size-3 self-center text-ink-3" />
                  </button>
                </td>
                {hasRef && (
                  <td className={gtd}>
                    <Money value={lines.reduce((s, l) => s + (l.refPrice ?? 0) * l.quantity, 0)} unit={subUnit} digits={subDigits} tone="grey" />
                  </td>
                )}
                {grid.vendors.map((v) => {
                  const cs = lines.map((l) => grid.cells[v.replyId][l.id])
                  const n = cs.filter((c) => c.unitPrice != null).length
                  const ok = awardable.has(v.replyId)
                  return (
                    <td key={v.replyId} className={`${gtd} pr-3`}>
                      {n === 0 ? <span className="text-ink-3">none</span> : <Money value={cs.reduce((s, c) => s + (c.lineCost ?? 0), 0)} unit={subUnit} digits={subDigits} tone={ok ? 'gold' : 'grey'} className={ok ? '!text-sky' : ''} />}
                      {n > 0 && n < lines.length && (
                        <span className="block text-sm text-ink-3">
                          {n} of {lines.length} lines
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>,
              ...(open ? rows : []).map((l) => {
                const li = shownLines.indexOf(l)
                const td = 'py-[11px] pl-[18px] border-b border-hair text-right whitespace-nowrap group-hover:bg-hover'
                return (
                  <tr key={l.id} className="group">
                    <td className={`${td} !pl-0 !text-left ${CODE}`}>{l.id}</td>
                    <td className={`${td} !pl-0 !text-left !whitespace-normal text-ink max-w-72`} title={l.description}>
                      {l.spec ?? l.description}
                    </td>
                    <td className={`${td} text-ink-2`}>{l.quantity.toLocaleString('en-IN')}</td>
                    {hasRef && <td className={`${td} text-ink-3`}>{price(l.refPrice)}</td>}
                    {grid.vendors.map((v, vi) => {
                      const c = grid.cells[v.replyId][l.id]
                      const ok = awardable.has(v.replyId)
                      const active = sel?.kind === 'cell' && sel.replyId === v.replyId && sel.lineId === l.id
                      const flagged = c.check === 'look' || c.check === 'no_price'
                      const isLow = c.unitPrice != null && ok && lowest[l.id] === c.unitPrice
                      const dim = filter !== 'all' && !matches(c, filter)
                      const pc = asPct && c.unitPrice != null && l.refPrice ? r2(((c.unitPrice - l.refPrice) / l.refPrice) * 100) : null
                      const openCell = isUnconfirmed(c)
                      const stateWord = c.check === 'not_quoted' ? 'not quoted' : c.check === 'no_price' ? 'no usable price' : c.check === 'look' ? 'needs a look' : openCell ? 'not confirmed yet' : 'confirmed'
                      const attr = attrDef ? c.attributes[attrDef.key] : null
                      return (
                        <td key={v.replyId} className="p-0 border-b border-hair group-hover:bg-hover">
                          <button
                            id={`cell-${v.replyId}-${l.id}`}
                            onClick={() => onSelect(v.replyId, l.id)}
                            onKeyDown={(e) => onKey(e, li, vi)}
                            aria-label={`${v.name}, ${l.id}, ${c.unitPrice != null ? price(c.unitPrice) : 'no price'}, ${stateWord}`}
                            className={`cell w-full py-[11px] pl-[18px] flex items-center justify-end gap-1.5 whitespace-nowrap rounded-lg ${ok ? 'text-gold' : 'text-ink-3'} ${active ? 'shadow-[inset_0_0_0_2px_var(--color-accent)]' : ''} ${dim ? 'opacity-35' : ''}`}
                          >
                            {flagged && <span className="text-sm text-stop">{c.check === 'no_price' ? 'no price' : 'look'}</span>}
                            {!attrDef && !asPct && c.marks.length > 0 && <span className="text-sm text-ink-3">{c.marks.join(' ')}</span>}
                            {attrDef ? (
                              <span className={attr ? 'text-ink' : 'text-ink-3 text-sm'}>{attr ? (attr.num != null ? `${attr.num}${attrDef.unit ? ` ${attrDef.unit.split(' ')[0]}` : ''}` : attr.text) : c.unitPrice != null ? 'not stated' : ''}</span>
                            ) : c.unitPrice != null ? (
                              <span className={isLow ? 'text-ink font-semibold' : ''}>{pc != null ? `${pc > 0 ? '+' : ''}${pc.toFixed(1)}%` : price(c.unitPrice)}</span>
                            ) : c.check === 'not_quoted' ? (
                              <span className="text-sm text-ink-3">not quoted</span>
                            ) : null}
                            {/* The dot follows the price. A confirmed price keeps the same width, so columns line up. */}
                            <i className={`udot ${openCell ? (ok ? '' : 'opacity-45') : 'invisible'}`} title={openCell ? 'Not confirmed yet' : undefined} />
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              }),
            ]
          })}
        </tbody>
      </table>
      <p className="mt-3.5 text-sm text-ink-3">
        {cols > 0 && `${word(grid.vendors.length)} ${grid.vendors.length === 1 ? 'vendor' : 'vendors'}, ${grid.lines.length} lines. `}Click a price to see the vendor's words.
      </p>
    </div>
  )
}
