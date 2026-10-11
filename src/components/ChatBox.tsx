import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ChatTurn } from '../lib/types.ts'
import { Markdown } from './Markdown.tsx'
import { Button, Spinner } from './ui.tsx'

// Thread and composer used by the co-pilot and the analyst. The question is quiet and the answer
// is the loud thing. The composer is one line that grows, and it is always on screen.
export function ChatBox({
  turns,
  busy,
  busyLabel = 'Working',
  onSend,
  placeholder,
  sendLabel = 'Send',
  quietSend,
  empty,
  chips,
  renderAnswer,
  inCard,
}: {
  turns: ChatTurn[]
  busy: boolean
  busyLabel?: string
  onSend: (text: string) => void
  placeholder: string
  sendLabel?: string
  // The screen already has its one primary button elsewhere.
  quietSend?: boolean
  empty?: ReactNode
  // Suggested questions, shown above the text box. They wrap to two lines.
  chips?: string[]
  // Custom layout for an assistant turn. Falls back to markdown.
  renderAnswer?: (turn: ChatTurn, index: number) => ReactNode
  // The box already sits on a glass card, so the composer is a well, not a second sheet of glass.
  inCard?: boolean
}) {
  const [text, setText] = useState('')
  const last = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  // Scroll to the top of a new turn, not its bottom, so the headline is what you see first.
  useEffect(() => {
    last.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [turns.length, busy])
  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  function submit(t = text) {
    const v = t.trim()
    if (!v || busy) return
    setText('')
    onSend(v)
  }
  const col = 'w-[min(860px,100%)] mx-auto'

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-auto">
        <div className={`${col} pb-6`}>
          {turns.length === 0 && empty}
          {turns.map((t, i) => {
            const isLast = i === turns.length - 1
            return t.role === 'user' ? (
              <p key={i} ref={isLast ? last : undefined} className="text-lg font-normal text-ink-2 whitespace-pre-wrap scroll-mt-2 mt-10 first:mt-0">
                <span className="block text-sm text-ink-3">You asked</span>
                {t.text}
              </p>
            ) : (
              <div key={i} ref={isLast && !busy ? last : undefined} className="scroll-mt-2 mt-5">
                {t.error ? <div className="border-l border-stop pl-3.5 text-stop">{t.text}</div> : renderAnswer ? renderAnswer(t, i) : <Markdown text={t.text} />}
              </div>
            )
          })}
          {busy && (
            <div className="flex items-center gap-2 text-ink-2 mt-5" role="status">
              <Spinner />
              {busyLabel}
            </div>
          )}
        </div>
      </div>
      <div className={`${col} shrink-0 pt-3 space-y-2.5`}>
        {chips && chips.length > 0 && (
          <div className="flex gap-2 flex-wrap max-h-[76px] overflow-hidden" aria-label="Suggested questions">
            {chips.map((q) => (
              <Chip key={q} disabled={busy} onClick={() => submit(q)}>
                {q}
              </Chip>
            ))}
          </div>
        )}
        <div className={`flex items-end gap-2.5 py-2.5 pr-2.5 ${inCard ? 'rounded-[18px] pl-4 bg-slip border border-hair-2' : 'glass rounded-[22px] pl-5'}`}>
          <textarea
            ref={box}
            aria-label="Your message"
            className={`flex-1 min-w-0 resize-none bg-transparent py-1.5 text-ink outline-none placeholder:text-ink-3 ${inCard ? 'text-base' : 'text-body'}`}
            rows={1}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <Button variant={quietSend ? 'quiet' : 'primary'} loading={busy} disabled={!text.trim()} onClick={() => submit()}>
            {sendLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function Chip({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className="btn min-h-9 px-[15px] py-1.5 border border-hair-2 rounded-[18px] bg-well text-md font-medium text-ink text-left hover:bg-white/12 disabled:opacity-45 disabled:pointer-events-none">
      {children}
    </button>
  )
}
