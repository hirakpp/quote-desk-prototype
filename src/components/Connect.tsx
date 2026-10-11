import { useEffect, useState } from 'react'
import { DEFAULT_MODEL, PROVIDER_LABEL } from '../config.ts'
import { getProvider, KEY_COPY } from '../lib/llm/index.ts'
import type { Llm } from '../lib/llm/index.ts'
import type { ProviderId } from '../lib/types.ts'
import { useStore } from '../store.tsx'
import { Button, Seg, Status } from './ui.tsx'

const PROVIDERS: ProviderId[] = ['anthropic', 'openai']

// Provider, key, model, test. Used on the home screen, in the connect box and in settings.
// The models offered are the ones the pasted key can use, listed from the provider's API.
export function Connect({ onDone, doneLabel = 'Connect and test' }: { onDone?: (llm: Llm) => void; doneLabel?: string }) {
  const { state, set, keys, saveKey, forgetKey } = useStore()
  const p = state.provider
  const provider = getProvider(p)
  const saved = keys[p]
  const [draftKey, setDraftKey] = useState('')
  const [models, setModels] = useState<{ id: string; label: string }[]>([])
  const [busy, setBusy] = useState<'' | 'list' | 'test'>('')
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState<string | null>(null)
  const model = state.models[p]
  const copy = KEY_COPY[p]

  const setModel = (id: string) => set((s) => ({ ...s, models: { ...s.models, [p]: id } }))

  // With a saved key, list what it can use so the model picker is real.
  useEffect(() => {
    setModels([])
    setError(null)
    setReply(null)
    setDraftKey('')
    if (!saved) return
    let dead = false
    void provider
      .listModels(saved)
      .then((m) => !dead && setModels(m))
      .catch(() => undefined)
    return () => {
      dead = true
    }
  }, [p, saved, provider])

  async function connect() {
    const key = (draftKey.trim() || saved).trim()
    if (!key) return
    setError(null)
    setReply(null)
    try {
      setBusy('list')
      const list = await provider.listModels(key)
      setModels(list)
      const pick = list.some((m) => m.id === model) ? model : list.some((m) => m.id === DEFAULT_MODEL[p]) ? DEFAULT_MODEL[p] : (list[0]?.id ?? model)
      if (!pick) throw new Error('This key lists no usable models. Type a model id below and try again.')
      setBusy('test')
      const text = await provider.test(key, pick)
      saveKey(p, key)
      setModel(pick)
      setReply(text || '(empty reply)')
      setDraftKey('')
      // A good test call goes straight in. No separate "Continue" click.
      onDone?.({ provider, key, model: pick })
    } catch (e) {
      setError(provider.explainError(e))
    } finally {
      setBusy('')
    }
  }

  const label = 'block text-sm font-medium text-ink-3 mb-1.5'
  const field = 'w-full h-11 rounded-[12px] px-3.5 bg-slip border outline-none focus:border-accent'

  return (
    <div>
      <div className="mt-[18px]">
        <span className={label}>Provider</span>
        <Seg small label="Model provider" value={p} onChange={(id) => set((s) => ({ ...s, provider: id }))} options={PROVIDERS.map((id) => ({ id, label: `${PROVIDER_LABEL[id]}${keys[id] ? ', key saved' : ''}` }))} />
      </div>

      <label className="block mt-[22px]">
        <span className={label}>{copy.label}</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
          className={`${field} font-mono text-md text-lilac placeholder:text-ink-3 placeholder:font-sans ${error ? 'border-stop' : 'border-hair-2'}`}
          placeholder={saved ? 'Saved in this browser. Paste a new key to replace it.' : copy.placeholder}
          value={draftKey}
          onChange={(e) => setDraftKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void connect()}
        />
      </label>
      {/* An error in a field: a red outline on the field and red text under it. */}
      {error && (
        <p className="mt-2 text-md text-stop" role="alert">
          {error}
        </p>
      )}

      {(saved || models.length > 0) && (
        <label className="block mt-[22px]">
          <span className={label}>Model</span>
          {models.length > 0 ? (
            <select className={`${field} border-hair-2 text-base text-ink`} value={model} onChange={(e) => setModel(e.target.value)}>
              {!models.some((m) => m.id === model) && model && <option value={model}>{model}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label === m.id ? m.id : `${m.label} (${m.id})`}
                </option>
              ))}
            </select>
          ) : (
            <input className={`${field} border-hair-2 text-base text-ink`} placeholder="Model id" value={model} onChange={(e) => setModel(e.target.value.trim())} />
          )}
          <span className="block mt-1.5 text-sm text-ink-3">
            {models.length > 0 ? 'Listed from the provider with your key. The same model reads documents and answers questions.' : 'Could not list models for this key yet. You can type a model id.'}
          </span>
        </label>
      )}

      <div className="mt-6 flex gap-2.5 items-center flex-wrap">
        <Button variant="primary" size="lg" loading={busy !== ''} disabled={!draftKey.trim() && !saved} onClick={() => void connect()}>
          {busy === 'list' ? 'Checking the key' : busy === 'test' ? 'Making a test call' : saved && !draftKey.trim() ? 'Test again' : doneLabel}
        </Button>
        {saved && (
          <Button variant="ghost" size="lg" onClick={() => forgetKey(p)}>
            Forget this key
          </Button>
        )}
      </div>
      <p className="mt-3 text-sm text-ink-3">{copy.where} Calls are billed to you, so a key with a spend limit is the sensible choice.</p>
      {reply && (
        <div className="mt-3 text-md">
          <Status tone="ok">Connected.</Status> <span className="text-ink-2">The model replied: {reply}</span>
        </div>
      )}
    </div>
  )
}
