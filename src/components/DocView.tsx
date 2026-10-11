import { useEffect, useRef, useState } from 'react'
import { parseFile } from '../lib/files.ts'
import type { Reply } from '../lib/types.ts'
import { useStore } from '../store.tsx'

// Shows a vendor file. Text formats show the text the model was given, with the quoted words
// highlighted in the trace colour. A PDF or photo is shown as it is.
export function DocView({ reply, quote, tall, datasetId }: { reply: Pick<Reply, 'id' | 'source' | 'fileName' | 'format' | 'docText'>; quote?: string | null; tall?: boolean; datasetId?: string }) {
  const { getBlob } = useStore()
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(reply.docText ?? null)
  const [gone, setGone] = useState(false)
  const pre = useRef<HTMLPreElement>(null)
  const ext = (reply.fileName.split('.').pop() ?? '').toLowerCase()
  const isPdf = ext === 'pdf'
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)

  useEffect(() => {
    setGone(false)
    if (reply.docText) return setText(reply.docText)
    setText(null)
    setUrl(null)
    let made: string | null = null
    let dead = false
    void getBlob(reply, datasetId).then(async (b) => {
      if (dead) return
      if (!b) return setGone(true)
      // Excel, Word and text files are read out in the browser. No model call, so this works without a key.
      if (!isPdf && !isImage) {
        try {
          const parsed = await parseFile(b, reply.fileName)
          if (!dead) setText(parsed.docText ?? '')
        } catch (e) {
          if (!dead) setText(e instanceof Error ? e.message : 'This file could not be opened.')
        }
        return
      }
      made = URL.createObjectURL(isPdf ? new Blob([b], { type: 'application/pdf' }) : b)
      setUrl(made)
    })
    return () => {
      dead = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [reply.id, reply.fileName, reply.docText, reply.source, datasetId, isPdf, isImage, getBlob])

  const hit = text != null && quote ? locate(text, quote) : null
  // Bring the highlight into view inside the document box only, so the rest of the panel stays put.
  useEffect(() => {
    const box = pre.current
    const m = box?.querySelector('mark')
    if (box && m) box.scrollTop = m.offsetTop - box.offsetTop - box.clientHeight / 2
  }, [text, quote])

  const h = tall ? 'max-h-[70vh]' : 'max-h-80'
  if (text != null) {
    return (
      <div>
        <div className="text-sm text-ink-3 mb-1.5">
          {reply.format === 'Excel' || reply.format === 'Word' ? `Text read out of the ${reply.format} file in your browser. This is what the model was given. ` : ''}
          {quote && (hit ? 'The quoted words are highlighted.' : 'The quoted words were not found word for word below.')}
        </div>
        <pre ref={pre} className={`relative rounded-[12px] bg-slip px-3.5 py-3 font-mono text-sm leading-5 text-ink whitespace-pre-wrap break-words overflow-auto ${h}`}>
          {hit ? (
            <>
              {text.slice(0, hit[0])}
              <mark>{text.slice(hit[0], hit[1])}</mark>
              {text.slice(hit[1])}
            </>
          ) : (
            text
          )}
        </pre>
      </div>
    )
  }
  if (gone) return <div className="text-sm text-ink-2">An uploaded file is not kept across a reload. Upload it again to see it here.</div>
  if (!url) return <div className="skeleton h-40" />
  return (
    <div>
      {quote !== undefined && <div className="text-sm text-ink-3 mb-1.5">The model reads this file directly. This prototype does not highlight the region, so find the quoted words in it by eye.</div>}
      {isPdf ? <iframe title={reply.fileName} src={url} className={`w-full border border-hair rounded-[12px] ${tall ? 'h-[70vh]' : 'h-[28rem]'}`} /> : <img alt={`Vendor file ${reply.fileName}`} src={url} className="w-full border border-hair rounded-[12px]" />}
    </div>
  )
}

// Find the quote in the text, ignoring spacing and punctuation differences.
function locate(text: string, quote: string): [number, number] | null {
  const exact = text.indexOf(quote)
  if (exact >= 0) return [exact, exact + quote.length]
  const tokens = quote.match(/[A-Za-z0-9₹.]+/g)
  if (!tokens || tokens.length === 0) return null
  const esc = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  try {
    const m = new RegExp(esc.join('[^A-Za-z0-9₹]*'), 'i').exec(text)
    return m ? [m.index, m.index + m[0].length] : null
  } catch {
    return null
  }
}
