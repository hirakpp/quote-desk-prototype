import type { ReactNode } from 'react'
import { extrasLabel, shortName } from '../lib/normalize.ts'
import { useStore } from '../store.tsx'
import { headWord } from './PricesGrid.tsx'
import { CODE } from './ui.tsx'

// Questionnaire answers and commercial terms in one table, one column per vendor, vendors you
// can award first. A gate answer leads with a word. Click an answer for the vendor's own words.
export function TermsTab({ onAnswer }: { onAnswer: (replyId: string, questionId: string) => void }) {
  const { grid } = useStore()
  const gate = grid.questionnaire.filter((q) => q.gate)
  const other = grid.questionnaire.filter((q) => !q.gate)
  const vendors = [...grid.vendors].sort((a, b) => Number(b.gate === 'pass') - Number(a.gate === 'pass'))
  const span = vendors.length + 1
  const td = 'py-[13px] pl-[18px] align-top border-t border-hair'
  const grey = <span className="font-normal text-ink-3">Not stated</span>
  const stated = (x: string | null) => (x && !/^not stated$/i.test(x.trim()) ? x : grey)

  const group = (title: string, note?: string) => (
    <tr>
      <td colSpan={span} className="pt-[22px] pb-2 text-lg font-semibold text-sky">
        {title}
        {note && <small className="ml-2.5 text-sm font-normal text-ink-3">{note}</small>}
      </td>
    </tr>
  )
  const question = (q: (typeof grid.questionnaire)[number]) => (
    <tr key={q.id}>
      <td className={`${td} !pl-0 pr-2.5 text-ink`}>
        <b className={`block ${CODE}`}>{q.id}</b>
        {q.text}
      </td>
      {vendors.map((v) => {
        const a = v.answers[q.id]
        if (!a?.answered) {
          return (
            <td key={v.replyId} className={`${td} text-ink-3`}>
              Not sent
            </td>
          )
        }
        const m = a.meets_requirement
        return (
          <td key={v.replyId} className={td}>
            <button className="block w-full text-left rounded hover:bg-hover" onClick={() => onAnswer(v.replyId, q.id)} title="See the vendor's words">
              {q.gate ? (
                <>
                  <span className={`block font-semibold ${m === 'yes' ? 'text-ok' : 'text-stop'}`}>{m === 'yes' ? 'Meets it' : m === 'no' ? 'Does not meet it' : 'Unclear'}</span>
                  <span className="mt-0.5 text-sm text-ink-2 line-clamp-2">{a.answer}</span>
                </>
              ) : (
                <span className="font-medium text-ink line-clamp-3">{a.answer}</span>
              )}
            </button>
          </td>
        )
      })}
    </tr>
  )
  const term = (label: string, cells: ReactNode[], muted?: boolean) => (
    <tr>
      <td className={`${td} !pl-0 ${muted ? 'text-ink-3' : 'text-ink'}`}>{label}</td>
      {cells.map((c, i) => (
        <td key={i} className={`${td} ${muted ? 'text-sm text-ink-3' : 'font-medium text-ink'}`}>
          {c}
        </td>
      ))}
    </tr>
  )

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[1040px] table-fixed border-collapse text-base">
        <thead>
          <tr>
            <th className="w-[300px]" />
            {vendors.map((v) => {
              const hw = headWord(grid, v)
              return (
                <th key={v.replyId} className="pl-[18px] pb-3 align-bottom text-left">
                  <span className={`block text-lg font-semibold tracking-[-0.012em] ${v.gate === 'pass' ? 'text-ink' : 'text-ink-3'}`} title={v.name}>
                    {shortName(v.name)}
                  </span>
                  <span className={`block text-sm font-medium ${hw.tone === 'ok' ? 'text-ok' : hw.tone === 'stop' ? 'text-stop' : 'text-ink-3'}`}>{hw.text}</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {gate.length > 0 && group('Quality gate', `${gate.length} question${gate.length > 1 ? 's' : ''}, all must be met`)}
          {gate.map(question)}
          {other.length > 0 && group(gate.length ? 'Other questions' : 'Questions')}
          {other.map(question)}
          {group('Commercial terms')}
          {term(
            extrasLabel(grid.rfx),
            vendors.map((v) => (v.freight === 'included' ? <span className="font-semibold text-ok">Included</span> : v.freight === 'extra' ? <span className="font-semibold text-stop">Extra</span> : grey)),
          )}
          {term(
            'GST',
            vendors.map((v) => (v.gst === 'not_stated' ? grey : v.gst === 'included' ? 'Included' : 'Extra')),
          )}
          {term(
            'Discount',
            vendors.map((v) => (v.discount ? `${v.discount.percent}%${v.discount.condition ? ', with a condition' : ''}. ${v.discount.applied ? 'Applied in the prices.' : 'Not applied in the prices.'}` : <span className="font-normal text-ink-3">None</span>)),
          )}
          {grid.vendors.some((v) => v.indexClause) &&
            term(
              'Price tied to an index',
              vendors.map((v) => (v.indexClause ? `${v.indexClause.indexName}: ${v.indexClause.percentPerUnit}% per unit` : <span className="font-normal text-ink-3">None</span>)),
            )}
          {term(
            'Prices valid for',
            vendors.map((v) => stated(v.validity)),
          )}
          {term(
            'Payment',
            vendors.map((v) => stated(v.payment)),
          )}
          {term(
            'Read by',
            vendors.map((v) => v.readBy || 'not recorded'),
            true,
          )}
        </tbody>
      </table>
      <p className="mt-3.5 text-sm text-ink-3">Click an answer to see the vendor's words in full.</p>
    </div>
  )
}
