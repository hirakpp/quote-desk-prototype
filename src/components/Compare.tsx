import { useEffect, useMemo, useState } from 'react'
import { doubtCards, openRules, shortName } from '../lib/normalize.ts'
import { useStore } from '../store.tsx'
import { PricesBar, PricesGrid, PricesKey } from './PricesGrid.tsx'
import { AnswerPanel, SourcePanel, VendorPanel } from './SourcePanel.tsx'
import { TermsTab } from './TermsTab.tsx'
import { Button, CTX, Empty, LEDE, MAIN, Seg, word } from './ui.tsx'

type TabId = 'prices' | 'terms'

// Compare: the working underneath Decide, on one card. The price grid, or the questionnaire and
// terms. A price, a vendor or an answer opens the source sheet at the right edge.
export function Compare() {
  const { state, grid, go, sel, setSel, pricesView, setPricesView, datasets } = useStore()
  const [tab, setTab] = useState<TabId>('prices')
  const rules = useMemo(() => openRules(grid), [grid])
  const doubts = useMemo(() => doubtCards(grid), [grid])
  const waiting = state.replies.filter((r) => r.status !== 'done').length

  // The walk order for Previous and Next in the source sheet: every cell that still needs a yes.
  const walk = useMemo(
    () => [...doubts.map((d) => ({ replyId: d.replyId, lineId: d.lineId })), ...rules.filter((r) => r.lineIds.length).map((r) => ({ replyId: r.replyId, lineId: r.lineIds[0] }))],
    [doubts, rules],
  )

  // The grid stays readable beside the sheet, so bring the selected cell into view.
  useEffect(() => {
    if (sel?.kind === 'cell') document.getElementById(`cell-${sel.replyId}-${sel.lineId}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [sel])

  // Drop a selection whose vendor is no longer in the grid.
  useEffect(() => {
    if (sel && !grid.vendors.some((v) => v.replyId === sel.replyId)) setSel(null)
  }, [grid, sel, setSel])

  if (grid.vendors.length === 0) {
    return (
      <Empty
        title="Nothing to compare yet."
        text="The price grid and the questionnaire answers appear here once at least one vendor reply is read."
        action={
          <Button variant="primary" size="lg" onClick={() => go('decide')}>
            Go to Decide
          </Button>
        }
      />
    )
  }

  const closePanel = () => {
    const back = sel?.kind === 'cell' ? document.getElementById(`cell-${sel.replyId}-${sel.lineId}`) : null
    setSel(null)
    back?.focus()
  }
  const selCell = sel?.kind === 'cell' ? grid.cells[sel.replyId]?.[sel.lineId] : null
  const selVendor = sel ? grid.vendors.find((v) => v.replyId === sel.replyId) : null
  const selReply = sel ? state.replies.find((r) => r.id === sel.replyId) : null

  const event = datasets.find((d) => d.id === state.datasetId)
  const N = grid.vendors.length
  const shared = grid.commonLineIds.length
  const units = [...new Set(grid.lines.map((l) => l.unit))]
  const gate = grid.questionnaire.filter((q) => q.gate).length
  const all = N === 1 ? 'the one vendor' : `all ${word(N).toLowerCase()}`
  const lede =
    tab === 'prices'
      ? `Same lines, same unit, rupees per ${units.length === 1 ? units[0] : 'unit asked for'}. ${shared ? `Totals are for the ${shared} lines ${all} quoted.` : 'No line was priced by every vendor, so each total is for the lines that vendor priced.'}`
      : gate
        ? `${word(gate)} of the ${word(grid.questionnaire.length).toLowerCase()} questions ${gate === 1 ? 'is' : 'are'} the quality gate. A vendor has to meet ${gate === 1 ? 'it' : `all ${word(gate).toLowerCase()}`} to be awarded.`
        : 'This RFx has no quality gate, so no answer stops an award.'

  return (
    <div className="page-w pt-9 pb-[72px]">
      <section className={MAIN}>
        <div className={CTX}>
          {[shortName(grid.rfx.buyer), event?.kind.toLowerCase()].filter(Boolean).join(' · ')}
          {waiting > 0 && <span className="text-stop">{` · ${waiting} of ${state.replies.length} replies not read`}</span>}
        </div>
        <h1 className="page-title mt-2">{tab === 'prices' ? 'Every price, side by side' : 'What each vendor answered'}</h1>
        <p className={`${LEDE} mt-3`}>{lede}</p>
        <div className="flex items-center gap-x-4 gap-y-3 flex-wrap mt-[22px]">
          <Seg
            small
            tabs
            label="Compare"
            value={tab}
            onChange={setTab}
            options={[
              { id: 'prices', label: 'Prices' },
              { id: 'terms', label: 'Questionnaire and terms' },
            ]}
          />
          {tab === 'prices' && <PricesKey />}
        </div>
        <div role="tabpanel">
          {tab === 'prices' && (
            <>
              <PricesBar view={pricesView} setView={setPricesView} />
              <PricesGrid view={pricesView} setView={setPricesView} sel={sel} onSelect={(replyId, lineId) => setSel({ kind: 'cell', replyId, lineId })} onVendor={(replyId) => setSel({ kind: 'vendor', replyId })} />
            </>
          )}
          {tab === 'terms' && <TermsTab onAnswer={(replyId, questionId) => setSel({ kind: 'answer', replyId, questionId })} />}
        </div>
      </section>

      {sel?.kind === 'cell' && selCell && selVendor && selReply && (
        <SourcePanel cell={selCell} vendor={selVendor} reply={selReply} walk={walk} edit={!!sel.edit} onGo={(replyId, lineId) => setSel({ kind: 'cell', replyId, lineId })} onClose={closePanel} />
      )}
      {sel?.kind === 'vendor' && selVendor && selReply && <VendorPanel vendor={selVendor} reply={selReply} onClose={closePanel} />}
      {sel?.kind === 'answer' && selVendor && selReply && <AnswerPanel vendor={selVendor} reply={selReply} questionId={sel.questionId} onClose={closePanel} />}
    </div>
  )
}
