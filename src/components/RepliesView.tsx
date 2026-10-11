import { useEffect, useRef, useState } from 'react'
import { PROVIDER_LABEL } from '../config.ts'
import type { Reply } from '../lib/types.ts'
import { useStore } from '../store.tsx'
import type { SampleReply } from '../store.tsx'
import { DocView } from './DocView.tsx'
import { shortName } from '../lib/normalize.ts'
import { Button, CTX, Dialog, Empty, ErrorTile, Fmt, LEDE, MAIN, NAME, Spinner } from './ui.tsx'

// The inbox. Works without a key: every raw file opens, with a line on what is awkward about it.
export function RepliesView() {
  const { state, set, go, addUpload, readReply, readAll, withModel, sampleReplies, receiveSamples, datasets } = useStore()
  const fileInput = useRef<HTMLInputElement>(null)
  const [hard, setHard] = useState<Record<string, string>>({})
  const [viewing, setViewing] = useState<Reply | null>(null)

  useEffect(() => {
    if (!state.datasetId) return setHard({})
    let dead = false
    void sampleReplies(state.datasetId).then((list: SampleReply[]) => !dead && setHard(Object.fromEntries(list.map((m) => [m.vendorId, m.hard]))))
    return () => {
      dead = true
    }
  }, [state.datasetId, sampleReplies])

  const upload = (
    <>
      <Button size="lg" onClick={() => fileInput.current?.click()}>
        Upload a vendor file
      </Button>
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept=".xlsx,.xls,.csv,.pdf,.docx,.jpg,.jpeg,.png,.webp,.txt,.eml"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) addUpload(f)
          e.target.value = ''
        }}
      />
    </>
  )

  if (state.draft.lineItems.length === 0) {
    return <Empty title="No RFx yet" text="Vendor replies are read against an RFx. Draft one first, or pick a sourcing event on the start screen." action={<Button variant="primary" size="lg" onClick={() => go('draft')}>Go to the RFx</Button>} />
  }
  if (state.replies.length === 0) {
    return (
      <Empty
        title="No replies yet"
        text={state.datasetId ? 'The sample vendor replies arrive here when the RFx is sent. Sending is simulated.' : 'There are no sample replies for your own draft. Upload a vendor file and it appears here, ready to be read.'}
        action={state.datasetId ? <Button variant="primary" size="lg" onClick={() => void receiveSamples()}>Send and receive the sample replies</Button> : upload}
      />
    )
  }

  const n = state.replies.length
  const pending = state.replies.filter((r) => r.status === 'received' || r.status === 'error').length
  const read = state.replies.filter((r) => r.status === 'done').length
  const busy = state.replies.some((r) => r.status === 'extracting')

  const event = datasets.find((x) => x.id === state.datasetId)

  return (
    <div className="page-w pt-9 pb-[72px]">
      <div className={`${MAIN} max-w-[1040px] mx-auto`}>
        <div className="flex items-start justify-between gap-6 max-md:flex-col">
          <div className="min-w-0">
            <div className={CTX}>{[shortName(state.draft.buyer), event?.kind.toLowerCase()].filter(Boolean).join(' · ')}</div>
            <h1 className="page-title mt-2">
              {n} repl{n === 1 ? 'y' : 'ies'} came back
            </h1>
          </div>
          <div className="flex gap-2.5 flex-wrap pt-4 max-md:pt-0">
            {upload}
            {pending > 0 && !busy ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() =>
                  withModel((l) => {
                    readAll(l)
                    go('decide')
                  })
                }
              >
                Read {pending === n ? (n === 1 ? 'it' : `all ${n}`) : `the other ${pending}`} and compare
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={() => go('decide')}>
                Open the decision
              </Button>
            )}
          </div>
        </div>
        <p className={`${LEDE} mt-3`}>The email is simulated. Every file opens without a model. {read > 0 ? `${read} of ${n} read.` : 'None is read yet.'}</p>

        <ul className="rows mt-5">
          {state.replies.map((r) => (
            <li key={r.id} className="grid grid-cols-[54px_1fr] md:grid-cols-[54px_1fr_auto] gap-x-3.5 gap-y-0.5 py-[18px] items-start">
              <div className="pt-[3px]">
                <Fmt format={r.format} fileName={r.fileName} />
              </div>
              <div className="min-w-0">
                <div className={NAME}>{r.vendorName}</div>
                <div className="font-mono text-sm text-lilac-2 truncate">
                  {r.fileName} · {r.source === 'sample' ? 'sample file' : 'uploaded'}
                </div>
                {hard[r.id] && <div className="mt-1.5 text-base text-ink-2 max-w-[46em]">{hard[r.id]}</div>}
                {r.status === 'done' && r.extraction && (
                  <div className="mt-1.5 text-sm text-ink-3">
                    Read by {r.provider ? PROVIDER_LABEL[r.provider] : ''} {r.model} in {r.seconds} s: {r.extraction.items.length} priced items, {r.extraction.answers.filter((a) => a.answered).length} questionnaire answers
                    {r.extraction.references.length > 0 && `, ${r.extraction.references.length} reference to an earlier price`}
                  </div>
                )}
                {r.status === 'error' && (
                  <div className="mt-3 max-w-[46em]">
                    <ErrorTile title="This file could not be read" text={r.error}>
                      <Button variant="primary" onClick={() => withModel((l) => void readReply(r.id, l))}>
                        Try again
                      </Button>
                      <Button variant="outline" onClick={() => setViewing(r)}>
                        Open the file
                      </Button>
                    </ErrorTile>
                    <p className="mt-2 text-sm text-ink-3">The other vendors are unaffected. Nothing is filled in for this one.</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 max-md:col-start-2 max-md:mt-2">
                <Button onClick={() => setViewing(r)}>Open the file</Button>
                {r.status === 'extracting' ? (
                  <span className="inline-flex items-center gap-1.5 text-ink-2 px-2.5 text-md" role="status">
                    <Spinner /> Reading
                  </span>
                ) : r.status === 'error' ? null : (
                  <Button variant="ghost" className="!px-2.5" onClick={() => withModel((l) => void readReply(r.id, l))}>
                    {r.status === 'done' ? 'Read again' : 'Read'}
                  </Button>
                )}
                {r.status !== 'extracting' && (
                  <Button variant="ghost" icon="x" className="!px-2.5" aria-label={`Remove the reply from ${r.vendorName}`} onClick={() => set((s) => ({ ...s, replies: s.replies.filter((x) => x.id !== r.id) }))} />
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-3 mt-2">Reading a file again clears anything you confirmed for that vendor, so a changed reading never inherits a confirmation.</p>
      </div>
      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `${viewing.vendorName}: ${viewing.fileName}` : ''} wide>
        {viewing && <DocView reply={viewing} tall />}
      </Dialog>
    </div>
  )
}
