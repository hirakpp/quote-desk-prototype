import { useRef, useState } from 'react'
import { askCopilot } from '../lib/copilot.ts'
import { price } from '../lib/normalize.ts'
import { useStore } from '../store.tsx'
import { ChatBox } from './ChatBox.tsx'
import { Button, CARD_TITLE, CODE, CTX, GOLD, LEDE, MAIN, SECTION } from './ui.tsx'

const STARTERS = [
  'I need annual rates for corrugated shipper cartons, about 30 sizes, delivered to Bhiwandi.',
  'Draft an RFx for an office laptop refresh: 400 laptops in three configurations, plus docks and monitors.',
  'I want to tender 30 full-truckload lanes out of our Pune and Hosur plants for a year.',
]

export function DraftView() {
  const { state, set, withModel, datasets, loadDataset, receiveSamples, addUpload, go } = useStore()
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState<Set<string>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)
  const d = state.draft
  const hasRef = d.lineItems.some((l) => l.refPrice != null)
  const empty = d.lineItems.length === 0 && !d.title
  const ownDraft = !state.datasetId && d.lineItems.length > 0

  function send(text: string) {
    withModel((llm) => {
      void (async () => {
        setBusy(true)
        const history = state.copilot
        const before = new Map(state.draft.lineItems.map((l) => [l.id, JSON.stringify(l)]))
        set((s) => ({ ...s, copilot: [...s.copilot, { role: 'user', text }] }))
        try {
          const res = await askCopilot(llm, state.draft, history, text)
          // Highlight the rows the co-pilot touched, for a moment.
          setChanged(new Set(res.draft.lineItems.filter((l) => before.get(l.id) !== JSON.stringify(l)).map((l) => l.id)))
          set((s) => ({ ...s, draft: res.draft, copilot: [...s.copilot, { role: 'assistant', text: res.text, toolCalls: res.toolCalls }] }))
        } catch (e) {
          set((s) => ({ ...s, copilot: [...s.copilot, { role: 'assistant', text: llm.provider.explainError(e), error: true }] }))
        } finally {
          setBusy(false)
        }
      })()
    })
  }

  function sendToVendors() {
    set((s) => ({ ...s, sent: true, view: 'replies' }))
    if (state.datasetId) void receiveSamples()
  }

  const th = 'py-2 pr-4 last:pr-0 font-medium text-sm text-ink-3 text-left'
  const td = 'py-[11px] pr-4 last:pr-0 border-t border-hair align-top'

  return (
    <div className="page-w pt-9 pb-[72px] grid grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] gap-7 items-start">
      <section className="glass card pt-6 px-[22px] pb-[22px] flex flex-col min-h-0 h-[70dvh] lg:sticky lg:top-[92px] lg:h-[calc(100dvh-206px)] lg:min-h-[480px]" aria-label="RFx co-pilot">
        <ChatBox
          turns={state.copilot}
          busy={busy}
          busyLabel="Updating the draft"
          onSend={send}
          quietSend
          inCard
          placeholder="Describe the category, the items and the quantities"
          empty={
            <div>
              <h1 className={CARD_TITLE}>Say what you need to buy</h1>
              <p className="mt-1.5 text-md text-ink-2">The draft on the right fills in as you talk. For example:</p>
              <div className="mt-2.5 grid gap-2.5">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="text-left px-3.5 py-3 rounded-strip bg-well text-base text-ink-2 hover:text-ink">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          }
        />
      </section>

      <section className={`${MAIN} min-w-0`} aria-label="RFx draft">
        {empty ? (
          <div className="max-w-md">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Nothing drafted yet.</h1>
            <p className="mt-2 text-lg font-normal text-ink-2">Line items, the supplier questionnaire and the terms appear here as you talk to the co-pilot. Or load a sample RFx to see a full one.</p>
            {datasets[0] && (
              <Button size="lg" className="mt-[18px]" onClick={() => void loadDataset(datasets[0].id)}>
                Use the {datasets[0].title.toLowerCase()} sample
              </Button>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-6 max-md:flex-col">
              <div className="min-w-0">
                <div className={CTX}>
                  <span className={CODE}>{d.id}</span> · {d.buyer}
                </div>
                <h1 className="page-title mt-2">{d.title || '(no title yet)'}</h1>
              </div>
              {state.sent ? (
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm text-ink-3">Sent, simulated</span>
                  <Button size="lg" onClick={() => go('replies')}>
                    See the replies
                  </Button>
                </div>
              ) : (
                d.lineItems.length > 0 && (
                  <Button variant="primary" size="lg" className="shrink-0" onClick={sendToVendors}>
                    Send to vendors
                  </Button>
                )
              )}
            </div>
            <p className={`${LEDE} mt-3`}>{d.scope}</p>
            {ownDraft && !state.sent && (
              <div className="mt-5 flex items-center gap-3 flex-wrap text-base text-ink-2">
                <span className="flex-1 min-w-64">This is your own draft, so there are no sample replies for it. Sending is simulated. To carry on, upload a vendor's reply file.</span>
                <Button onClick={() => fileInput.current?.click()}>Upload a vendor file</Button>
              </div>
            )}
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept=".xlsx,.xls,.csv,.pdf,.docx,.jpg,.jpeg,.png,.webp,.txt,.eml"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  addUpload(f)
                  go('replies')
                }
                e.target.value = ''
              }}
            />
            <h2 className={`${SECTION} mt-9`}>{d.lineItems.length} line items</h2>
            <div className="overflow-x-auto mt-2.5">
              <table className="w-full border-collapse text-base">
                <thead>
                  <tr>
                    <th className={th}>Line</th>
                    <th className={th}>Description</th>
                    <th className={`${th} max-lg:hidden`}>Category</th>
                    <th className={`${th} !text-right`}>{d.quantityLabel}</th>
                    {hasRef && <th className={`${th} !text-right first-letter:uppercase`}>{d.refLabel}</th>}
                  </tr>
                </thead>
                <tbody>
                  {d.lineItems.map((l) => (
                    <tr key={l.id} className={changed.has(l.id) ? 'flash' : ''}>
                      <td className={`${td} ${CODE} w-[52px]`}>{l.id}</td>
                      <td className={`${td} text-ink`}>{l.description}</td>
                      <td className={`${td} text-sky whitespace-nowrap max-lg:hidden`}>{l.category}</td>
                      <td className={`${td} text-right whitespace-nowrap text-ink`}>
                        {l.quantity.toLocaleString('en-IN')} <span className="text-ink-3 ml-0.5">{l.unit}</span>
                      </td>
                      {hasRef && <td className={`${td} text-right ${GOLD}`}>{price(l.refPrice)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className={`${SECTION} mt-9`}>{d.questionnaire.length} questions for the supplier</h2>
            <ol className="mt-3 grid grid-cols-[44px_1fr] gap-y-2.5 text-base text-ink">
              {d.questionnaire.map((q) => (
                <li key={q.id} className="contents">
                  <b className={CODE}>{q.id}</b>
                  <span>
                    {q.text} {q.gate && <span className="inline-block ml-1.5 text-sm font-semibold px-2 rounded-full text-sky bg-sky-soft whitespace-nowrap">Quality gate</span>}
                  </span>
                </li>
              ))}
            </ol>

            {d.attributes.length > 0 && (
              <>
                <h2 className={`${SECTION} mt-9`}>Asked for on every line</h2>
                <p className="mt-3 text-base text-ink">{d.attributes.map((a) => `${a.label}${a.unit ? ` (${a.unit})` : ''}`).join(', ')}</p>
              </>
            )}

            <h2 className={`${SECTION} mt-9`}>Terms</h2>
            <dl className="mt-3 grid grid-cols-[170px_1fr] max-sm:grid-cols-1 gap-y-2.5 max-sm:gap-y-0.5 text-base">
              {Object.entries(d.terms).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-3 max-sm:mt-2">{termLabel(k)}</dt>
                  <dd className="text-ink">{termValue(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>
    </div>
  )
}

// A term's label is words, not a field name: "priceBasis" reads "Price basis".
const TERM_LABELS: Record<string, string> = { responseDue: 'Replies due', validity: 'Prices valid for' }
function termLabel(key: string): string {
  if (TERM_LABELS[key]) return TERM_LABELS[key]
  const words = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
// A date written 2026-10-24 reads "24 October 2026".
function termValue(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())
  if (!m) return v
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m[2]) - 1]
  return month ? `${Number(m[3])} ${month} ${m[1]}` : v
}
