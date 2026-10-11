import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_MODEL } from './config.ts'
import { EMPTY_RFX } from './lib/copilot.ts'
import { extractDocument } from './lib/extract.ts'
import { parseFile } from './lib/files.ts'
import { forgetKey as dropKey, getProvider, loadKeys, saveKey as storeKey } from './lib/llm/index.ts'
import type { Llm } from './lib/llm/index.ts'
import { buildGrid } from './lib/normalize.ts'
import { emptyDecisions } from './lib/types.ts'
import type { ChatTurn, Decisions, Grid, ProviderId, Reply, Rfx } from './lib/types.ts'

// App state lives in React and is mirrored to localStorage (never the raw files, never a key).
const SLOT = 'rfx.state.v2'
export type View = 'home' | 'draft' | 'replies' | 'decide' | 'compare' | 'ask'

// What the source sheet on Compare is showing.
export type Sel = { kind: 'cell'; replyId: string; lineId: string; edit?: boolean } | { kind: 'vendor'; replyId: string } | { kind: 'answer'; replyId: string; questionId: string } | null

export type Filter = 'all' | 'flagged' | 'missing' | 'converted'
export interface PricesView {
  filter: Filter
  // What each cell shows: the price, the percent against the reference price, or one line attribute.
  mode: string
  closed: string[]
}
export const defaultPricesView: PricesView = { filter: 'all', mode: 'price', closed: [] }

// One sourcing event from public/samples/index.json. Questions only, never answers.
export interface DatasetCard {
  id: string
  title: string
  buyer: string
  kind: string
  // Rough size of the buy, shown beside the name: "₹4 crore" and "a year".
  value: string
  valueNote: string
  summary: string
  whyCheapestIsWrong: string
  edges: string[]
  questions: string[]
  rfxId: string
  lines: number
  vendors: number
  questionCount: number
}

export interface SampleReply {
  vendorId: string
  vendorName: string
  file: string
  format: string
  hard: string
}

export interface AppState {
  provider: ProviderId
  models: Record<ProviderId, string>
  view: View
  // Which sample dataset the draft came from. Null for a draft written with the co-pilot.
  datasetId: string | null
  draft: Rfx
  sent: boolean
  replies: Reply[]
  decisions: Decisions
  analyst: ChatTurn[]
  copilot: ChatTurn[]
}

const fresh = (): AppState => ({
  provider: 'anthropic',
  models: { ...DEFAULT_MODEL },
  view: 'home',
  datasetId: null,
  draft: EMPTY_RFX,
  sent: false,
  replies: [],
  decisions: emptyDecisions(),
  analyst: [],
  copilot: [],
})

function load(): AppState {
  try {
    const raw = localStorage.getItem(SLOT)
    if (!raw) return fresh()
    const s = { ...fresh(), ...(JSON.parse(raw) as Partial<AppState>) }
    s.decisions = { ...emptyDecisions(), ...s.decisions }
    // A reload kills any call that was in flight.
    s.replies = s.replies.map((r) => (r.status === 'extracting' ? { ...r, status: 'received' } : r))
    // Results became Decide and Compare.
    if ((s.view as string) === 'run' || (s.view as string) === 'results') s.view = s.replies.length ? 'decide' : 'home'
    return s
  } catch {
    return fresh()
  }
}

// Drop every decision the buyer made about one vendor's file. Used when the file is read again,
// so a changed reading never inherits a confirmation nobody gave it.
function clearDecisionsFor(d: Decisions, replyId: string): Decisions {
  const keep = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith(`${replyId}|`)))
  const { [replyId]: _drop, ...discount } = d.discount
  return { rules: keep(d.rules), doubts: keep(d.doubts), overrides: keep(d.overrides), noted: keep(d.noted), discount }
}

interface Store {
  state: AppState
  set: (fn: (s: AppState) => AppState) => void
  go: (view: View) => void
  keys: Record<ProviderId, string>
  saveKey: (id: ProviderId, key: string) => void
  forgetKey: (id: ProviderId) => void
  // Null until the chosen provider has a key and a model.
  llm: Llm | null
  explain: (e: unknown) => string
  // Runs the action now if a model is connected. Otherwise opens the connect box and runs it after.
  withModel: (action: (llm: Llm) => void) => void
  connectOpen: boolean
  closeConnect: () => void
  onConnected: (llm: Llm) => void
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  // Compare: what the source sheet shows and how the grid is filtered. Not kept across a reload.
  sel: Sel
  setSel: (sel: Sel) => void
  pricesView: PricesView
  setPricesView: (v: PricesView) => void
  openCompare: (sel?: Sel, filter?: Filter) => void
  // A question another screen wants asked. Ask sends it to the live analyst once, then clears it.
  pendingAsk: string | null
  askNow: (question: string | null) => void
  grid: Grid
  datasets: DatasetCard[]
  storageWarning: string | null
  reset: () => void
  loadDataset: (id: string) => Promise<void>
  sampleReplies: (id: string) => Promise<SampleReply[]>
  sampleUrl: (datasetId: string, file: string) => string
  // Pass the dataset id when calling right after loadDataset, before the new state has landed.
  receiveSamples: (datasetId?: string) => Promise<void>
  runEndToEnd: (id: string) => void
  addUpload: (file: File) => void
  readReply: (id: string, llm?: Llm) => Promise<void>
  readAll: (llm?: Llm) => void
  // Pass the dataset id to open a sample file of an event that is not loaded.
  getBlob: (reply: Pick<Reply, 'id' | 'source' | 'fileName'>, datasetId?: string) => Promise<Blob | null>
}

const Ctx = createContext<Store | null>(null)
export const useStore = () => {
  const s = useContext(Ctx)
  if (!s) throw new Error('store missing')
  return s
}

const sampleUrl = (datasetId: string, file: string) => `${import.meta.env.BASE_URL}samples/${datasetId}/${file}`

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load)
  const [keys, setKeys] = useState(loadKeys)
  const [datasets, setDatasets] = useState<DatasetCard[]>([])
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sel, setSel] = useState<Sel>(null)
  const [pricesView, setPricesView] = useState<PricesView>(defaultPricesView)
  const [pendingAsk, setPendingAsk] = useState<string | null>(null)
  const pending = useRef<((llm: Llm) => void) | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const blobs = useRef(new Map<string, Blob>())

  useEffect(() => {
    try {
      localStorage.setItem(SLOT, JSON.stringify(state))
      setStorageWarning(null)
    } catch {
      setStorageWarning('Browser storage is full, so this session will not survive a reload.')
    }
  }, [state])

  useEffect(() => {
    void fetch(`${import.meta.env.BASE_URL}samples/index.json`)
      .then((r) => r.json())
      .then((d) => setDatasets(d as DatasetCard[]))
      .catch(() => setDatasets([]))
  }, [])

  const set = useCallback((fn: (s: AppState) => AppState) => setState(fn), [])
  const go = useCallback((view: View) => setState((s) => ({ ...s, view })), [])
  const openCompare = useCallback((next: Sel = null, filter?: Filter) => {
    setSel(next)
    if (filter) setPricesView((v) => ({ ...v, filter }))
    setState((s) => ({ ...s, view: 'compare' }))
  }, [])
  const askNow = useCallback((question: string | null) => {
    setPendingAsk(question)
    if (question) setState((s) => ({ ...s, view: 'ask' }))
  }, [])
  const patchReply = useCallback(
    (id: string, patch: Partial<Reply>) => set((s) => ({ ...s, replies: s.replies.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
    [set],
  )

  const key = keys[state.provider]
  const model = state.models[state.provider]
  const llm = useMemo<Llm | null>(() => (key && model ? { provider: getProvider(state.provider), key, model } : null), [state.provider, key, model])
  const llmRef = useRef(llm)
  llmRef.current = llm

  const saveKey = useCallback((id: ProviderId, k: string) => {
    storeKey(id, k)
    setKeys((x) => ({ ...x, [id]: k }))
  }, [])
  const forgetKey = useCallback((id: ProviderId) => {
    dropKey(id)
    setKeys((x) => ({ ...x, [id]: '' }))
  }, [])

  const explain = useCallback((e: unknown) => getProvider(stateRef.current.provider).explainError(e), [])

  const withModel = useCallback((action: (llm: Llm) => void) => {
    if (llmRef.current) return action(llmRef.current)
    pending.current = action
    setConnectOpen(true)
  }, [])
  const closeConnect = useCallback(() => {
    pending.current = null
    setConnectOpen(false)
  }, [])
  const onConnected = useCallback((l: Llm) => {
    setConnectOpen(false)
    const p = pending.current
    pending.current = null
    p?.(l)
  }, [])

  const grid = useMemo(() => buildGrid(state.draft, state.replies, state.decisions), [state.draft, state.replies, state.decisions])

  const reset = useCallback(() => {
    blobs.current.clear()
    setSel(null)
    setPricesView(defaultPricesView)
    setState((s) => ({ ...fresh(), provider: s.provider, models: s.models }))
  }, [])

  const loadDataset = useCallback(
    async (id: string) => {
      const res = await fetch(sampleUrl(id, 'rfx.json'))
      const rfx = (await res.json()) as Rfx
      blobs.current.clear()
      setSel(null)
      setPricesView(defaultPricesView)
      set((s) => ({ ...s, datasetId: id, draft: rfx, sent: false, replies: [], decisions: emptyDecisions(), analyst: [], copilot: [] }))
    },
    [set],
  )

  const sampleReplies = useCallback(async (id: string) => {
    const res = await fetch(sampleUrl(id, 'replies.json'))
    return (await res.json()) as SampleReply[]
  }, [])

  const receiveSamples = useCallback(async (datasetId?: string) => {
    const id = datasetId ?? stateRef.current.datasetId
    if (!id) return
    const list = await sampleReplies(id)
    set((s) => {
      const have = new Set(s.replies.map((r) => r.id))
      const add: Reply[] = list
        .filter((m) => !have.has(m.vendorId))
        .map((m) => ({ id: m.vendorId, vendorName: m.vendorName, fileName: m.file, format: m.format, source: 'sample', status: 'received' }))
      return { ...s, sent: true, replies: [...s.replies, ...add] }
    })
  }, [set, sampleReplies])

  const addUpload = useCallback(
    (file: File) => {
      const id = `U${Date.now().toString(36)}`
      blobs.current.set(id, file)
      const guess = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
      set((s) => ({
        ...s,
        sent: true,
        replies: [...s.replies, { id, vendorName: guess, fileName: file.name, format: 'Upload', source: 'upload', status: 'received' }],
      }))
    },
    [set],
  )

  const getBlob = useCallback(async (reply: Pick<Reply, 'id' | 'source' | 'fileName'>, datasetId?: string): Promise<Blob | null> => {
    const ds = datasetId ?? stateRef.current.datasetId
    const slot = reply.source === 'sample' ? `${ds}/${reply.fileName}` : reply.id
    const have = blobs.current.get(slot)
    if (have) return have
    if (reply.source !== 'sample' || !ds) return null
    const res = await fetch(sampleUrl(ds, reply.fileName))
    if (!res.ok) return null
    const b = await res.blob()
    blobs.current.set(slot, b)
    return b
  }, [])

  const readReply = useCallback(
    async (id: string, given?: Llm) => {
      const l = given ?? llmRef.current
      const reply = stateRef.current.replies.find((r) => r.id === id)
      if (!l || !reply || reply.status === 'extracting') return
      const { draft } = stateRef.current
      patchReply(id, { status: 'extracting', error: undefined })
      const t0 = Date.now()
      try {
        const blob = await getBlob(reply)
        if (!blob) throw new Error('The uploaded file is no longer in memory (files are not kept across a reload). Upload it again.')
        const parsed = await parseFile(blob, reply.fileName)
        const extraction = await extractDocument(l, draft, parsed.parts, reply.fileName)
        set((s) => ({
          ...s,
          // A new reading starts with no confirmations.
          decisions: clearDecisionsFor(s.decisions, id),
          replies: s.replies.map((r) =>
            r.id === id
              ? {
                  ...r,
                  status: 'done',
                  extraction,
                  docText: parsed.docText,
                  format: parsed.format,
                  provider: l.provider.id,
                  model: l.model,
                  seconds: Math.round((Date.now() - t0) / 1000),
                  vendorName: r.source === 'upload' && extraction.vendor_name ? extraction.vendor_name : r.vendorName,
                }
              : r,
          ),
        }))
      } catch (e) {
        patchReply(id, { status: 'error', error: l.provider.explainError(e) })
      }
    },
    [getBlob, patchReply, set],
  )

  const readAll = useCallback(
    (given?: Llm) => {
      for (const r of stateRef.current.replies) if (r.status === 'received' || r.status === 'error') void readReply(r.id, given)
    },
    [readReply],
  )

  const autoRead = useRef<Llm | null>(null)
  // One button to a result: load the RFx, "send", receive the sample replies, read them all.
  const runEndToEnd = useCallback(
    (id: string) => {
      withModel((l) => {
        void (async () => {
          await loadDataset(id)
          await receiveSamples(id)
          autoRead.current = l
          set((s) => ({ ...s, view: 'decide' }))
        })()
      })
    },
    [withModel, loadDataset, receiveSamples, set],
  )
  // Start reading once Decide is showing and the replies are in state.
  useEffect(() => {
    if (!autoRead.current || state.view !== 'decide' || state.replies.length === 0) return
    const l = autoRead.current
    autoRead.current = null
    readAll(l)
  }, [state.view, state.replies, readAll])

  const value: Store = {
    state,
    set,
    go,
    keys,
    saveKey,
    forgetKey,
    llm,
    explain,
    withModel,
    connectOpen,
    closeConnect,
    onConnected,
    settingsOpen,
    setSettingsOpen,
    sel,
    setSel,
    pricesView,
    setPricesView,
    openCompare,
    pendingAsk,
    askNow,
    grid,
    datasets,
    storageWarning,
    reset,
    loadDataset,
    sampleReplies,
    sampleUrl,
    receiveSamples,
    runEndToEnd,
    addUpload,
    readReply,
    readAll,
    getBlob,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
