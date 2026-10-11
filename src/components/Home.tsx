import { useEffect, useState } from 'react'
import { useStore } from '../store.tsx'
import type { SampleReply } from '../store.tsx'
import { DocView } from './DocView.tsx'
import { Button, CARD_TITLE, CTX, Dialog, Fmt, GOLD, Icon, LEDE, LINK, MAIN, NAME, SECTION, withMoney } from './ui.tsx'

// First screen. A list of sourcing events on the left, the selected one on the right.
// No key wall: every file opens without a model. Reading them is the one button.
export function Home() {
  const { state, set, datasets, runEndToEnd, loadDataset, sampleReplies, go, askNow } = useStore()
  const [picked, setPicked] = useState<string | null>(state.datasetId)
  const d = datasets.find((x) => x.id === picked) ?? datasets[0]
  const [files, setFiles] = useState<SampleReply[]>([])
  const [viewing, setViewing] = useState<SampleReply | null>(null)

  useEffect(() => {
    if (!d) return
    let dead = false
    setFiles([])
    void sampleReplies(d.id).then((list) => !dead && setFiles(list))
    return () => {
      dead = true
    }
  }, [d?.id, sampleReplies])

  // The event already on the desk can be carried on instead of read again.
  const loaded = d && state.datasetId === d.id && state.replies.length > 0
  const read = loaded && state.replies.some((r) => r.status === 'done')
  const count = files.length || d?.vendors || 0
  const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']

  async function openRfx(id: string) {
    if (state.datasetId !== id) await loadDataset(id)
    go('draft')
  }

  const who = (x: { buyer: string; kind: string }) => `${x.buyer.replace(/ (Pvt Ltd|Ltd)$/, '')} · ${x.kind.toLowerCase()}`

  return (
    <div className="page-w pt-9 pb-[72px] grid grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] gap-7 items-start">
      <nav aria-label="Sourcing events" className="glass card pt-[22px] px-2.5 pb-3">
        <h1 className={`${CARD_TITLE} px-3.5`}>Sourcing events</h1>
        <p className="px-3.5 mt-1 mb-3 text-md text-ink-2">Each has an RFx with 30 lines and five vendor replies in five different shapes.</p>
        {datasets.length === 0 && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[60px] mx-2.5 mb-2 !rounded-strip" />)}
        {datasets.map((x) => (
          <button key={x.id} aria-pressed={x.id === d?.id} onClick={() => setPicked(x.id)} className={`grid grid-cols-[1fr_auto] gap-x-3.5 gap-y-px w-full text-left py-[13px] px-3.5 rounded-strip ${x.id === d?.id ? 'bg-white/10' : 'hover:bg-well'}`}>
            <span className={NAME}>{x.title}</span>
            <span className={`text-lg text-right ${GOLD}`}>{x.value}</span>
            <span className="text-sm text-ink-3 truncate">{who(x)}</span>
            <span className="text-sm text-ink-3 text-right">{x.valueNote}</span>
          </button>
        ))}
        <p className="px-3.5 pt-3.5 pb-1.5 text-md text-ink-3">
          Or{' '}
          <button className={LINK} onClick={() => set((s) => ({ ...s, view: 'draft' }))}>
            draft your own RFx
          </button>{' '}
          by talking to the co-pilot.
        </p>
      </nav>

      {d ? (
        <section className={`${MAIN} min-w-0`} aria-label={d.title}>
          <div className={CTX}>{who(d)}</div>
          <h2 className="page-title mt-2">{d.title}</h2>
          <p className={`${LEDE} mt-3`}>{withMoney(`${d.summary} ${d.whyCheapestIsWrong}`)}</p>
          <div className="flex gap-2.5 items-center mt-6 flex-wrap">
            {read ? (
              <Button variant="primary" size="lg" onClick={() => go('decide')}>
                Open the decision
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={() => runEndToEnd(d.id)}>
                Read all {WORDS[count] ?? count} and compare
              </Button>
            )}
            <Button size="lg" onClick={() => void openRfx(d.id)}>
              Open the RFx
            </Button>
            {read && (
              <Button size="lg" variant="ghost" onClick={() => runEndToEnd(d.id)}>
                Read again from scratch
              </Button>
            )}
          </div>
          <p className="mt-3 text-sm text-ink-3">Reading takes a live model call per file, on your own key. The email is simulated.</p>

          <h3 className={`${SECTION} mt-9`}>The {WORDS[count] ?? count} replies</h3>
          <ul className="rows mt-2">
            {files.length === 0 && [0, 1, 2, 3, 4].map((i) => <li key={i} className="skeleton h-9 my-2" />)}
            {files.map((f, i) => (
              <li key={f.vendorId}>
                <button onClick={() => setViewing(f)} className="grid grid-cols-[54px_1fr] md:grid-cols-[54px_280px_1fr] gap-x-3.5 gap-y-0.5 items-baseline w-full text-left py-3 hover:bg-hover" title="Open the file">
                  <Fmt format={f.format} fileName={f.file} />
                  <span className="text-body font-medium text-ink">{f.vendorName}</span>
                  <span className="text-md text-ink-2 max-md:col-start-2">{d.edges[i] ?? f.hard}</span>
                </button>
              </li>
            ))}
          </ul>

          <h3 className={`${SECTION} mt-9`}>Questions this event can answer</h3>
          {/* Once the replies are read, a question goes to the live analyst. Before that it is only a list. */}
          <ol className="rows mt-2">
            {d.questions.map((q) => (
              <li key={q}>
                {read ? (
                  <button className="group flex justify-between items-center gap-4 w-full text-left py-[13px] text-body text-ink" onClick={() => askNow(q)}>
                    {q}
                    <Icon name="chevron" className="size-3.5 text-ink-3 group-hover:text-accent" />
                  </button>
                ) : (
                  <div className="py-[13px] text-body text-ink">{q}</div>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className={MAIN}>
          <div className="skeleton h-11 w-72" />
        </section>
      )}

      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `${viewing.vendorName}: ${viewing.file}` : ''} wide>
        {viewing && d && <DocView reply={{ id: viewing.vendorId, source: 'sample', fileName: viewing.file, format: viewing.format }} datasetId={d.id} tall />}
      </Dialog>
    </div>
  )
}
