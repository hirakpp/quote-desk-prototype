import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell as BarCell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AwardInput, AwardResult, ChartSpec } from '../lib/analysis.ts'
import { askAnalyst } from '../lib/analyst.ts'
import { exportAward, exportGrid } from '../lib/exportXlsx.ts'
import { inr, inrShort, perPeriod, price, shortName } from '../lib/normalize.ts'
import type { ChatTurn, ToolCallRecord } from '../lib/types.ts'
import { useStore } from '../store.tsx'
import { ChatBox, Chip } from './ChatBox.tsx'
import { Button, CODE, Empty, GOLD, LINK, SECTION, withMoney, word } from './ui.tsx'

// Fallback suggestions for a draft that did not come from a sample. Questions only: every
// answer is a live tool loop, never stored or scripted.
const GENERIC = ["What came back, and what can't I trust yet?", 'What if we split it, cheapest per line?', 'What does that cost versus giving it all to one vendor?', 'Which lines have only one vendor pricing them?']

export function AskView() {
  const { state, set, grid, go, withModel, datasets, pendingAsk, askNow } = useStore()
  const [busy, setBusy] = useState(false)
  const chips = datasets.find((d) => d.id === state.datasetId)?.questions ?? GENERIC

  function ask(text: string) {
    withModel((llm) => {
      void (async () => {
        setBusy(true)
        const history = state.analyst
        set((s) => ({ ...s, analyst: [...s.analyst, { role: 'user', text }] }))
        try {
          const res = await askAnalyst(llm, state.draft, grid, history, text)
          set((s) => ({ ...s, analyst: [...s.analyst, { role: 'assistant', text: res.text, answer: res.answer, toolCalls: res.toolCalls }] }))
        } catch (e) {
          set((s) => ({ ...s, analyst: [...s.analyst, { role: 'assistant', text: llm.provider.explainError(e), error: true }] }))
        } finally {
          setBusy(false)
        }
      })()
    })
  }

  // A question handed over from Decide. It goes to the live analyst like any typed question.
  useEffect(() => {
    if (!pendingAsk || busy || grid.vendors.length === 0) return
    askNow(null)
    ask(pendingAsk)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk])

  if (grid.vendors.length === 0) {
    return (
      <Empty
        title="Nothing to ask about yet."
        text="The analyst answers questions over the comparison, so it needs at least one vendor reply to be read first."
        action={
          <Button variant="primary" size="lg" onClick={() => go('decide')}>
            Go to Decide
          </Button>
        }
      />
    )
  }

  return (
    // The thread fills what is left under the toolbar, so the composer is always on screen.
    <div className="page-w pt-9 pb-4 flex flex-col h-[calc(100dvh-154px)] min-h-[520px] max-lg:h-[calc(100dvh-210px)]">
      <section className="min-w-0 flex-1 flex flex-col min-h-0" aria-label="Analyst">
        <ChatBox
          turns={state.analyst}
          busy={busy}
          busyLabel="Working it out with the tools"
          onSend={ask}
          sendLabel="Ask"
          placeholder="Ask about these quotes"
          empty={
            <div className="glass card px-[30px] max-sm:px-5 py-7">
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Ask about these quotes.</h1>
              <p className="mt-2 text-lg font-normal text-ink-2">Answers use the prices on Compare. Every figure is computed by code, not guessed. The analyst works out options. It does not award.</p>
              <div className="mt-[18px] grid gap-2">
                {chips.map((q) => (
                  <button key={q} disabled={busy} onClick={() => ask(q)} className="text-left px-3.5 py-3 rounded-strip bg-well text-base text-ink-2 hover:text-ink disabled:opacity-45">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          }
          renderAnswer={(t) => <AnswerCard turn={t} onAsk={ask} busy={busy} />}
        />
      </section>
      <p className="mt-3 text-center text-sm text-ink-3">
        Every figure is computed by code from the grid.
        {state.analyst.length > 0 && !busy && (
          <>
            {' '}
            <button className={LINK} onClick={() => set((s) => ({ ...s, analyst: [] }))}>
              Clear this conversation
            </button>
          </>
        )}
      </p>
    </div>
  )
}

// One answer on one glass card: the headline with its figures in gold, the points, one red strip
// for what is not firm, the options as a plain table, then follow-ups.
function AnswerCard({ turn, onAsk, busy }: { turn: ChatTurn; onAsk: (q: string) => void; busy: boolean }) {
  const { grid } = useStore()
  const calls = (turn.toolCalls ?? []).filter((c) => !c.isError && !(c.result as { error?: string })?.error)
  const awards = calls.filter((c) => c.name === 'award_scenario').map((c) => ({ r: c.result as AwardResult, input: c.input as AwardInput }))
  const charts = calls.filter((c) => c.name === 'render_chart').map((c) => c.result as ChartSpec)
  const exports = calls.filter((c) => c.name === 'export_xlsx')
  const a = turn.answer ?? { headline: turn.text, points: [], caveats: [], follow_ups: [] }
  const last = awards[awards.length - 1]
  const open = last && last.r.unconfirmed_prices_used > 0

  return (
    <article className="glass card px-[34px] max-sm:px-5 pt-[30px] pb-7">
      <h2 className="text-2xl font-semibold tracking-[-0.02em] text-ink text-balance">{withMoney(a.headline)}</h2>
      {a.points.length > 0 && (
        <ul className="mt-[18px] grid gap-2.5 text-body text-ink-2">
          {a.points.map((p) => (
            <li key={p} className="relative pl-[18px] before:absolute before:left-0.5 before:top-2.5 before:size-[5px] before:rounded-full before:bg-ink-3">
              {withMoney(p)}
            </li>
          ))}
        </ul>
      )}
      {(open || a.caveats.length > 0) && (
        <div className="strip flex gap-3 items-center mt-5 px-3.5 py-3 text-base">
          {open && <span className="flex-none h-[26px] px-[11px] rounded-full text-sm leading-[26px] font-semibold bg-lift text-white">Not firm yet</span>}
          <span>
            {open && `${last.r.unconfirmed_prices_used} of these ${last.r.lines_awarded} prices rest on things you haven't confirmed. `}
            {a.caveats.join(' ')}
          </span>
        </div>
      )}
      {awards.length > 0 && <Options awards={awards} />}
      {charts.map((c, i) => (
        <Chart key={i} spec={c} />
      ))}
      {(a.follow_ups.length > 0 || last || exports.length > 0) && (
        <div className="mt-5 flex gap-2 flex-wrap">
          {a.follow_ups.map((q) => (
            <Chip key={q} disabled={busy} onClick={() => onAsk(q)}>
              {q}
            </Chip>
          ))}
          {last && <Chip onClick={() => exportAward(grid, last.input)}>Export this</Chip>}
          {exports.map((c, i) => {
            const input = c.input as { kind: string; scenario?: AwardInput }
            return input.kind === 'award_scenario' && last ? null : (
              <Chip key={i} onClick={() => (input.kind === 'award_scenario' ? exportAward(grid, input.scenario ?? { eligible_vendors: 'all' }) : exportGrid(grid))}>
                Export the {input.kind === 'award_scenario' ? 'award scenario' : 'comparison'}
              </Chip>
            )
          })}
        </div>
      )}
      {turn.toolCalls && turn.toolCalls.length > 0 && (
        <details className="mt-4 text-ink-3 text-sm">
          <summary className="cursor-pointer select-none rounded">
            How this was worked out: {turn.toolCalls.length} step{turn.toolCalls.length > 1 ? 's' : ''}, computed in code
          </summary>
          <ol className="mt-2 space-y-2 list-decimal pl-5 text-ink-2 text-md">
            {turn.toolCalls.map((c, k) => (
              <li key={k}>
                {describe(c)} {c.isError && <span className="text-stop">This step returned an error, so it was not used.</span>}
                <details className="mt-1">
                  <summary className="cursor-pointer select-none text-sm text-ink-3 rounded">Show raw</summary>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-sm text-ink-2 bg-slip rounded-[12px] p-3">
                    {c.name}({JSON.stringify(c.input)}){'\n'}
                    {JSON.stringify(c.result, null, 1).slice(0, 6000)}
                  </pre>
                </details>
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  )
}

// Each step as a sentence. Built from the tool call's own inputs.
function describe(c: ToolCallRecord): string {
  const i = (c.input ?? {}) as Record<string, unknown>
  const who = Array.isArray(i.vendors) && i.vendors.length ? ` for ${(i.vendors as string[]).join(', ')}` : ''
  if (c.name === 'get_grid') {
    const bits = [i.only && i.only !== 'all' ? `only ${String(i.only).replace(/_/g, ' ')} prices` : 'the price grid', i.category ? `in ${i.category}` : '', i.include_questionnaire ? 'with the questionnaire answers' : '', i.include_attributes ? 'with line attributes' : '']
    return `Read ${bits.filter(Boolean).join(' ')}${who}.`
  }
  if (c.name === 'aggregate' || c.name === 'render_chart') {
    const by = String(i.group_by ?? 'vendor').replace(/_/g, ' ')
    const extra = [i.exact_match_only ? 'exact-match items only' : '', i.attribute ? `comparing on ${i.attribute}` : '', i.sort_by ? `sorted by ${String(i.sort_by).replace(/_/g, ' ')}` : '', i.top_n ? `top ${i.top_n}` : ''].filter(Boolean).join(', ')
    return `${c.name === 'render_chart' ? `Drew a chart of ${String(i.metric ?? '').replace(/_/g, ' ')}` : 'Added up costs'} by ${by}${who}${extra ? ` (${extra})` : ''}.`
  }
  if (c.name === 'award_scenario') {
    const r = c.result as Partial<AwardResult>
    return `Computed an award. ${r.rule ?? ''}${r.what_if ? ' This one is a what-if.' : ''}`
  }
  if (c.name === 'export_xlsx') return `Prepared an Excel download of the ${i.kind === 'award_scenario' ? 'award scenario' : 'comparison grid'}.`
  return `Ran ${c.name}.`
}

// The award scenarios computed for one answer, as columns of a plain table.
function Options({ awards }: { awards: { r: AwardResult; input: AwardInput }[] }) {
  const { grid } = useStore()
  const per = perPeriod(grid.rfx)
  const unit = grid.lines[0]?.unit ?? 'unit'
  const n = awards.length
  const vendors = [...new Map(awards.flatMap((x) => x.r.vendors_in_award).map((v) => [v.vendor_id, v.vendor])).entries()]
  const th = 'py-2 pl-[18px] text-right text-sm font-medium text-ink-3 align-bottom'
  const td = 'py-[11px] pl-[18px] text-right text-ink border-t border-hair align-top'
  const label = 'py-[11px] text-left text-ink-2 border-t border-hair align-top'
  const refWord = /^last year$/i.test(grid.rfx.refLabel) ? 'last year' : `the ${grid.rfx.refLabel} price`
  return (
    <div className="mt-[26px] pt-[22px] border-t border-hair">
      <h3 className={SECTION}>{n === 1 ? awards[0].r.name : n === 2 ? 'The two options' : `The ${word(n).toLowerCase()} options`}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse mt-2.5 text-base">
          <thead>
            <tr>
              <th />
              {awards.map((x, i) => (
                <th key={i} className={th}>
                  {n > 1 ? x.r.name : x.r.what_if ? 'A what-if, not a quote' : 'Computed, not an award'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={label}>Cost{per}</td>
              {awards.map((x, i) => (
                <td key={i} className={`${td} !text-gold font-semibold`}>
                  {x.r.total_display}
                </td>
              ))}
            </tr>
            <tr>
              <td className={`${label} first-letter:uppercase`}>Against {refWord}</td>
              {awards.map((x, i) => (
                <td key={i} className={`${td} ${x.r.reference_cost_same_lines && x.r.saving_vs_reference > 0 ? '!text-ok' : ''}`}>
                  {x.r.reference_cost_same_lines ? `${inrShort(Math.abs(x.r.saving_vs_reference))} ${x.r.saving_vs_reference >= 0 ? 'under' : 'over'}` : 'none on file'}
                </td>
              ))}
            </tr>
            {vendors.map(([id, name]) => (
              <tr key={id}>
                <td className={label}>{shortName(name)}</td>
                {awards.map((x, i) => {
                  const v = x.r.vendors_in_award.find((y) => y.vendor_id === id)
                  return (
                    <td key={i} className={td}>
                      {v ? (
                        <>
                          {v.lines} line{v.lines === 1 ? '' : 's'} · <b className={GOLD}>{v.cost_display}</b>
                        </>
                      ) : (
                        <span className="text-ink-3">0 lines</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {awards.some((x) => x.r.lines_awarded < x.r.lines_total) && (
              <tr>
                <td className={label}>Lines covered</td>
                {awards.map((x, i) => (
                  <td key={i} className={td}>
                    {x.r.lines_awarded} of {x.r.lines_total}
                  </td>
                ))}
              </tr>
            )}
            <tr>
              <td className={label}>Prices not confirmed</td>
              {awards.map((x, i) => (
                <td key={i} className={td}>
                  {x.r.unconfirmed_prices_used}
                </td>
              ))}
            </tr>
            {awards.some((x) => x.r.what_if) && (
              <tr>
                <td className={label}>What-if</td>
                {awards.map((x, i) => (
                  <td key={i} className={td}>
                    {x.r.what_if ? 'Yes, not a quote' : 'No'}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {awards.map((x, i) => (
        <AwardDetail key={i} r={x.r} scenario={x.input} unit={unit} many={n > 1} />
      ))}
    </div>
  )
}

// The rule, the caveats and every awarded line behind one option.
function AwardDetail({ r, scenario, unit, many }: { r: AwardResult; scenario: AwardInput; unit: string; many: boolean }) {
  const { grid } = useStore()
  return (
      <details className="mt-3">
        <summary className="cursor-pointer select-none text-ink-3 text-sm rounded">Lines, rule and caveats{many ? `: ${r.name}` : ''}</summary>
        <div className="mt-3 space-y-3 text-md">
          <p className="text-ink-2">{r.rule}</p>
          <p className="text-ink-2">{r.rests_on}</p>
          {r.what_if_notes.length > 0 && (
            <ul className="list-disc pl-5 text-ink-2">
              {r.what_if_notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {r.best_single_eligible_vendor && (
            <p className="text-ink-2">
              Best single eligible vendor: {r.best_single_eligible_vendor.vendor} at {r.best_single_eligible_vendor.cost_display}, which is {inrShort(Math.abs(r.best_single_eligible_vendor.extra_cost_vs_this_split))}{' '}
              {r.best_single_eligible_vendor.extra_cost_vs_this_split >= 0 ? 'more' : 'less'} than this split.
            </p>
          )}
          {r.excluded_vendors.length > 0 && <p className="text-ink-2">Left out: {r.excluded_vendors.map((e) => `${e.vendor} (${e.reason})`).join('; ')}</p>}
          {r.caveats.length > 0 && (
            <ul className="list-disc pl-5 text-ink-2 space-y-0.5">
              {r.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          <div className="overflow-auto max-h-80 rounded-[12px] bg-slip">
            <table className="w-full border-collapse text-sm text-ink-2">
              <thead className="sticky top-0 bg-glass-solid">
                <tr className="text-left text-ink-3">
                  <th className="py-1.5 px-2 font-normal">Line</th>
                  <th className="py-1.5 px-2 font-normal">To</th>
                  <th className="py-1.5 px-2 font-normal text-right">₹ per {unit}</th>
                  <th className="py-1.5 px-2 font-normal text-right">Quantity</th>
                  <th className="py-1.5 px-2 font-normal text-right">Cost</th>
                  <th className="py-1.5 px-2 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {r.awards.map((a, i) => (
                  <tr key={i} className="border-t border-hair">
                    <td className={`py-1 px-2 ${CODE}`} title={a.description}>
                      {a.line}
                    </td>
                    <td className="py-1 px-2">{shortName(a.vendor)}</td>
                    <td className="py-1 px-2 text-right">{price(a.unit_price)}</td>
                    <td className="py-1 px-2 text-right">
                      {a.quantity.toLocaleString('en-IN')}
                      {a.billed_quantity > a.quantity && <span className="text-ink-3"> (pays for {a.billed_quantity.toLocaleString('en-IN')})</span>}
                    </td>
                    <td className="py-1 px-2 text-right text-gold">{inr(a.cost, 0)}</td>
                    <td className={`py-1 px-2 ${a.unconfirmed ? 'text-stop' : 'text-ink-3'}`}>{a.unconfirmed ? 'not confirmed' : 'confirmed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button onClick={() => exportAward(grid, scenario)}>Download as XLSX</Button>
        </div>
      </details>
  )
}


// Bar and stacked bar only. Series take the accent, its lighter step, then green. Every bar
// carries its value as text, and percent bars carry their sign, so direction never depends on colour.
const INK = 'var(--color-ink)'
const GREY = 'var(--color-ink-3)'
const BAR = 'var(--color-accent)'
const BAR_2 = 'var(--color-accent-ink)'
const STACK = [BAR, BAR_2, 'var(--color-ok)', 'var(--color-ink-3)', 'var(--color-accent-2)']

function Chart({ spec }: { spec: ChartSpec }) {
  const [asTable, setAsTable] = useState(false)
  const stacked = spec?.kind === 'stacked'
  const n = stacked ? spec.rows.length : (spec?.bars?.length ?? 0)
  if (!n) return null
  const pct = spec.unit === '%'
  const fmt = (v: number) => (pct ? `${v > 0 ? '+' : ''}${v}%` : spec.unit === '₹' ? inrShort(v) : String(v))
  return (
    <div className="mt-[26px] pt-[22px] border-t border-hair">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h3 className={SECTION}>{spec.title}</h3>
        <span className="text-sm text-ink-3">{spec.metric.replace(/_/g, ' ')}, computed in code</span>
        <button className={`${LINK} ml-auto text-sm whitespace-nowrap`} onClick={() => setAsTable((x) => !x)}>
          {asTable ? 'Show as a chart' : 'Show as a table'}
        </button>
      </div>
      {asTable ? (
        <table className="w-full border-collapse mt-3 text-md text-ink-2">
          <tbody>
            {stacked
              ? spec.rows.map((r) => (
                  <tr key={r.label} className="border-t border-hair">
                    <td className="py-1.5 pr-2">{r.label}</td>
                    {spec.series.map((s) => (
                      <td key={s} className="py-1.5 px-2 text-right">
                        <span className="text-ink-3">{s}:</span> {fmt(Number(r[s] ?? 0))}
                      </td>
                    ))}
                  </tr>
                ))
              : spec.bars.map((b) => (
                  <tr key={b.label} className="border-t border-hair">
                    <td className="py-1.5 pr-2">{b.label}</td>
                    <td className="py-1.5 text-right">{fmt(b.value)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      ) : (
        <div style={{ height: Math.max(180, n * 30 + (stacked ? 70 : 40)) }} className="mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stacked ? spec.rows : spec.bars} layout="vertical" margin={{ left: 8, right: 64 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke="var(--color-hair)" />
              <XAxis type="number" tickFormatter={fmt} fontSize={13} stroke={GREY} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="label" width={190} fontSize={13} interval={0} stroke={GREY} tick={{ fill: 'var(--color-ink-2)' }} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v) => fmt(Number(v))}
                cursor={{ fill: 'var(--color-well)' }}
                contentStyle={{ background: 'var(--color-glass-solid)', border: '1px solid var(--color-hair-2)', borderRadius: 12, color: INK }}
                itemStyle={{ color: INK }}
                labelStyle={{ color: 'var(--color-ink-2)' }}
              />
              {stacked ? (
                <>
                  <Legend wrapperStyle={{ fontSize: 13, color: 'var(--color-ink-2)' }} />
                  {spec.series.map((s, i) => (
                    <Bar key={s} dataKey={s} stackId="a" fill={STACK[i % STACK.length]} isAnimationActive={false} />
                  ))}
                </>
              ) : (
                <Bar dataKey="value" isAnimationActive={false} radius={3}>
                  <LabelList dataKey="value" position="right" formatter={(v: unknown) => fmt(Number(v))} fontSize={13} fill="var(--color-gold)" />
                  {spec.bars.map((b, i) => (
                    <BarCell key={i} fill={pct && b.value < 0 ? BAR_2 : BAR} />
                  ))}
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {pct && !asTable && <div className="text-sm text-ink-3 mt-1">Blue bars are above the reference, pale bars are below. Every bar carries its sign.</div>}
    </div>
  )
}
