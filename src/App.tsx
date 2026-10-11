import { useEffect, useRef, useState } from 'react'
import { AskView } from './components/AskView.tsx'
import { Compare } from './components/Compare.tsx'
import { Connect } from './components/Connect.tsx'
import { Decide } from './components/Decide.tsx'
import { DraftView } from './components/DraftView.tsx'
import { Home } from './components/Home.tsx'
import { RepliesView } from './components/RepliesView.tsx'
import { Button, Dialog, Icon, LEDE, MENU, MENU_ITEM, SECTION, Seg, useMenu } from './components/ui.tsx'
import { ANTHROPIC_MODELS } from './config.ts'
import { StoreProvider, useStore } from './store.tsx'
import type { View } from './store.tsx'

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

type TabId = Extract<View, 'decide' | 'compare' | 'ask'>

function Shell() {
  const { state, go, datasets, storageWarning, connectOpen, closeConnect, onConnected, settingsOpen, setSettingsOpen, llm } = useStore()
  const menu = useMenu()
  const hasDraft = state.draft.lineItems.length > 0
  const read = state.replies.filter((r) => r.status === 'done').length
  const started = state.view !== 'home'
  const event = datasets.find((d) => d.id === state.datasetId)
  const name = event?.title ?? (state.draft.title || 'Untitled RFx')
  const tab = state.view === 'decide' || state.view === 'compare' || state.view === 'ask' ? state.view : null
  // Back goes to the screen you came from, and to the list of events when there is none.
  const trail = useRef<View[]>([])
  const last = useRef<View>(state.view)
  const goingBack = useRef(false)
  useEffect(() => {
    if (state.view === last.current) return
    if (goingBack.current) goingBack.current = false
    else if (state.view === 'home') trail.current = []
    else trail.current.push(last.current)
    last.current = state.view
  }, [state.view])
  const back = () => {
    goingBack.current = true
    go(trail.current.pop() ?? 'home')
  }
  const pick = (v: View) => {
    menu.close()
    go(v)
  }

  // Decide, Compare, Ask. RFx and Replies sit behind the event name, since the person deciding rarely needs them.
  const seg = (
    <Seg<TabId>
      tabs
      label="Screens"
      value={tab}
      onChange={go}
      options={[
        { id: 'decide', label: 'Decide', disabled: !started || state.replies.length === 0 },
        { id: 'compare', label: 'Compare', disabled: !started || read === 0 },
        { id: 'ask', label: 'Ask', disabled: !started || read === 0 },
      ]}
    />
  )

  return (
    <div className="min-h-dvh flex flex-col">
      <div className="text-center pt-[30px] pb-1">
        <button className="brand" onClick={() => go('home')} title="All sourcing events">
          Quote desk
        </button>
      </div>
      <header className="bar glass page-w flex items-center gap-3.5 pl-3.5 pr-3 shrink-0 *:whitespace-nowrap">
        <div className="flex-1 basis-0 min-w-0 flex items-center gap-2.5">
          {started ? (
            <>
              <button onClick={back} aria-label="Back" title="Back" className="btn size-8 shrink-0 grid place-items-center rounded-[10px] text-ink hover:bg-well">
                <Icon name="back" className="size-3.5" bold />
              </button>
              {/* The event name is a title, not a caption. */}
              <button ref={menu.btn} popoverTarget="event-menu" onClick={() => menu.place()} className="flex items-center gap-[7px] text-lg font-semibold tracking-[-0.012em] text-ink min-w-0">
                <span className="truncate">{name}</span>
                <svg viewBox="0 0 10 10" className="size-2.5 shrink-0 stroke-ink-3 fill-none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 3.5l3 3 3-3" />
                </svg>
              </button>
            </>
          ) : (
            <span className="pl-1.5 text-lg font-semibold tracking-[-0.012em] text-ink">Sourcing events</span>
          )}
        </div>
        <div className="hidden lg:block">{seg}</div>
        <div className="flex-1 basis-0 min-w-0 flex justify-end">
          <button className="flex items-center gap-2 text-sm text-ink-2 hover:text-ink px-2 py-[7px] rounded-[10px] min-w-0" onClick={() => setSettingsOpen(true)} title={llm ? `${(ANTHROPIC_MODELS.find((m) => m.id === llm.model)?.label ?? llm.model).replace(/ \(.*\)$/, '')}. Model and settings` : 'Model and settings'}>
            {llm && <i className="size-[7px] rounded-full shrink-0 bg-ok" />}
            <span className="truncate max-[520px]:hidden">{llm ? `${state.provider === 'anthropic' ? 'Claude' : 'OpenAI'} connected` : 'No model connected'}</span>
          </button>
        </div>
      </header>
      <div ref={menu.pop} id="event-menu" popover="auto" className={MENU}>
        <button className={MENU_ITEM} onClick={() => pick('draft')}>
          Open the RFx
        </button>
        <button className={MENU_ITEM} disabled={!hasDraft} onClick={() => pick('replies')}>
          See the replies
        </button>
        <div className="h-px bg-hair mx-3 my-1.5" />
        <button className={MENU_ITEM} onClick={() => pick('home')}>
          All sourcing events
        </button>
      </div>
      {started && <div className="lg:hidden flex justify-center mt-3">{seg}</div>}
      {storageWarning && <div className="page-w text-stop text-sm mt-3">{storageWarning}</div>}
      <main className="flex-1 flex flex-col">
        {state.view === 'home' && <Home />}
        {state.view === 'draft' && <DraftView />}
        {state.view === 'replies' && <RepliesView />}
        {state.view === 'decide' && <Decide />}
        {state.view === 'compare' && <Compare />}
        {state.view === 'ask' && <AskView />}
      </main>

      <Dialog open={connectOpen} onClose={closeConnect} title="Connect a model" big>
        <p className={`${LEDE} mb-1`}>Quote desk reads vendor files and answers questions with your own key.</p>
        <Connect onDone={onConnected} doneLabel="Connect and carry on" />
      </Dialog>
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { reset, go } = useStore()
  const [confirming, setConfirming] = useState(false)
  return (
    <Dialog
      open={open}
      onClose={() => {
        setConfirming(false)
        onClose()
      }}
      title="Settings"
      wide
    >
      <div className="space-y-6">
        <section>
          <h3 className={`${SECTION} mb-1`}>Model</h3>
          <Connect />
          <p className="text-sm text-ink-3 mt-3">Switching provider keeps your results. Each vendor file records which provider and model read it.</p>
        </section>
        <section className="border-t border-hair pt-5">
          <h3 className={`${SECTION} mb-1.5`}>Start over</h3>
          <p className="text-ink-2 mb-3">Clears the RFx, replies, readings, confirmations and chats in this browser. Your API keys are kept.</p>
          {confirming ? (
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  reset()
                  setConfirming(false)
                  onClose()
                  go('home')
                }}
              >
                Yes, clear everything
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <Button onClick={() => setConfirming(true)}>Reset the demo</Button>
          )}
        </section>
        <p className="text-sm text-ink-3">Prototype. Sending and receiving email is simulated. Reading and analysis are live model calls.</p>
      </div>
    </Dialog>
  )
}
