import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { moneyParts, price } from '../lib/normalize.ts'
import type { MoneyUnit } from '../lib/normalize.ts'
import type { GateStatus } from '../lib/types.ts'

// Shared controls. Every control has hover, focus-visible, pressed, disabled and loading states.

const ICONS = {
  check: 'M4 10.5l4 4 8-9',
  x: 'M5 5l10 10M15 5L5 15',
  chevron: 'M7 4l6 6-6 6',
  down: 'M4 7l6 6 6-6',
  back: 'M13 4l-6 6 6 6',
  download: 'M10 3v10m0 0l-4-4m4 4l4-4M4 16h12',
  doc: 'M6 3h6l3 3v11H6V3zm6 0v3h3',
  undo: 'M7 5L3 9l4 4M3 9h9a4 4 0 010 8h-2',
  upload: 'M10 14V4m0 0L6 8m4-4l4 4M4 16h12',
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, className = 'size-4', bold }: { name: IconName; className?: string; bold?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={bold ? 2.6 : 1.75} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  )
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`shrink-0 animate-spin ${className}`} aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M10 3a7 7 0 017 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// Pills. Primary is the white pill, and there is one per screen. `done` is the pressed state of
// a white pill inside a green tile.
type Variant = 'primary' | 'quiet' | 'ghost' | 'danger' | 'done' | 'outline'
const VARIANT: Record<Variant, string> = {
  primary: 'btn-primary bg-white text-ground hover:bg-pill-hover border border-transparent',
  quiet: 'bg-well text-ink border border-hair-2 hover:bg-white/12',
  ghost: 'text-ink-2 hover:bg-well hover:text-ink border border-transparent',
  danger: 'text-stop border border-red-line hover:bg-red-glass',
  done: 'bg-lift text-white border border-transparent',
  outline: 'text-white border border-white/45 hover:border-white',
}

export function Button({
  variant = 'quiet',
  size = 'md',
  loading,
  icon,
  keys,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: IconName; keys?: string; ref?: Ref<HTMLButtonElement> }) {
  // Page buttons are 40px with 15px text. Row buttons are 34px with 14px.
  const sz = size === 'sm' ? 'h-[30px] px-3 text-sm gap-1.5' : size === 'lg' ? 'h-10 px-5 text-base gap-2' : 'h-[34px] px-[15px] text-md gap-1.5'
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className={`btn inline-flex items-center justify-center rounded-full font-semibold whitespace-nowrap disabled:opacity-45 disabled:pointer-events-none ${sz} ${VARIANT[variant]} ${className}`}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} className="size-3.5" bold={icon === 'check'} /> : null}
      {children}
      {keys && <kbd>{keys}</kbd>}
    </button>
  )
}

// A link on neutral glass is the accent. Inside a red or green tile it is white and underlined.
export const LINK = 'text-accent font-medium hover:underline underline-offset-[3px] rounded'
export const LINK_ON_TILE = 'text-white underline decoration-white/45 underline-offset-[3px] hover:decoration-white rounded'

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
// A small count as a word: "Two of five".
export const word = (n: number) => WORDS[n] ?? String(n)

// The names of things on every page, so one kind of text has one size and one colour.
export const CTX = 'text-md font-medium text-ink-3'
export const LEDE = 'text-lede tracking-[-0.008em] text-ink-2 max-w-[34em]'
export const SECTION = 'text-xl font-semibold tracking-[-0.018em] text-sky'
export const CARD_TITLE = 'text-xl font-semibold tracking-[-0.018em] text-ink'
export const NAME = 'text-lg font-semibold tracking-[-0.012em] text-ink'
export const CODE = 'font-mono text-sm font-medium text-lilac'
export const GOLD = 'text-gold font-semibold'
// The main card on a page.
export const MAIN = 'glass card px-[34px] max-sm:px-5 pt-[30px] pb-[34px]'

// Rupee figures inside a sentence are gold. A figure followed by "under" or "less" is a saving, in green.
export function withMoney(text: string): ReactNode[] {
  return text.split(/(₹\s?[\d,.]+(?:\s(?:crore|lakh|cr|L)\b)?(?:\s(?:under|less|lower|saved)\b)?)/g).map((part, i) =>
    i % 2 === 0 ? part : /(under|less|lower|saved)$/.test(part) ? <b key={i} className="font-semibold text-ok">{part}</b> : <b key={i} className={GOLD}>{part}</b>,
  )
}

// Every rupee amount that is a result is drawn by this: the figure, then a quiet unit word.
// Gold by default. White is for the hero and for a vendor you can award. Dim is a blocked vendor.
export function Money({
  value,
  unit,
  digits = 2,
  suffix,
  unitWord,
  tone = 'gold',
  className = '',
}: {
  tone?: 'gold' | 'white' | 'dim' | 'grey'
  value: number | null | undefined
  unit?: MoneyUnit
  digits?: number
  // Words after the unit, for example "a year".
  suffix?: string
  // Short unit word for tight columns: "cr" for crore.
  unitWord?: string
  className?: string
}) {
  if (value == null || Number.isNaN(value)) return null
  const p = moneyParts(value, unit, digits)
  const word = [p.unit ? (unitWord ?? p.unit) : '', suffix].filter(Boolean).join(' ')
  return (
    <span className={`money ${tone === 'gold' ? '' : tone} ${className}`}>
      {p.figure}
      {word && <small>{word}</small>}
    </span>
  )
}

// A price per unit. Two decimals, not a column total, so no unit word.
export function UnitPrice({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  if (value == null) return null
  return <span className={className}>{price(value)}</span>
}

// Segmented control. Used for Decide, Compare, Ask, and for the grid filters.
export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
  small,
  tabs,
}: {
  value: T | null
  options: { id: T; label: string; count?: number; need?: boolean; disabled?: boolean }[]
  onChange: (id: T) => void
  label: string
  small?: boolean
  tabs?: boolean
}) {
  return (
    <div role={tabs ? 'tablist' : 'radiogroup'} aria-label={label} className="inline-flex p-[3px] bg-well rounded-[12px] shrink-0">
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            role={tabs ? 'tab' : 'radio'}
            aria-selected={tabs ? on : undefined}
            aria-checked={tabs ? undefined : on}
            disabled={o.disabled}
            onClick={() => onChange(o.id)}
            className={`${small ? 'h-8 px-3.5 text-md' : 'h-9 px-[18px] text-base'} rounded-[9px] font-medium whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none ${
              on ? 'bg-lift text-ink shadow-[0_1px_0_rgba(255,255,255,.12)_inset,0_1px_3px_rgba(0,0,0,.3)]' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {o.label}
            {o.count != null && o.count > 0 && <span className={`ml-1.5 ${o.need ? 'text-stop font-semibold' : 'text-ink-3'}`}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

const FMT: Record<string, string> = { Excel: 'XLSX', Word: 'DOCX', Photo: 'JPG', Email: 'EML', PDF: 'PDF', Text: 'TXT' }
// The format tag on a vendor file: XLSX, PDF, DOCX, JPG, EML.
export function Fmt({ format, fileName }: { format: string; fileName: string }) {
  const word = FMT[format] ?? (fileName.split('.').pop() ?? 'file').toUpperCase().slice(0, 4)
  return <span className="inline-block font-mono font-semibold text-tag tracking-[0.04em] px-1.5 rounded-[5px] bg-lilac-soft text-lilac self-start justify-self-start shrink-0">{word}</span>
}

// Mark the given pieces of a quote.
function traced(quote: string, find: (string | null | undefined)[]): ReactNode {
  const hits = find
    .filter((f): f is string => !!f && f.trim().length > 1)
    .map((f) => ({ at: quote.toLowerCase().indexOf(f.trim().toLowerCase()), len: f.trim().length }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at)
  const out: ReactNode[] = []
  let pos = 0
  hits.forEach((h, i) => {
    if (h.at < pos) return
    out.push(quote.slice(pos, h.at), <mark key={i}>{quote.slice(h.at, h.at + h.len)}</mark>)
    pos = h.at + h.len
  })
  out.push(quote.slice(pos))
  return out
}

// Evidence slip: the vendor's own words. Mono, because it is quoted source text. It is a dark
// well, so it reads the same on neutral glass and inside a red or green tile.
export function Slip({ fileName, quote, find = [], whole, empty }: { format?: string; fileName: string; quote: string | null; find?: (string | null | undefined)[]; whole?: boolean; empty?: string }) {
  return (
    <div className="rounded-strip bg-slip px-3.5 py-3 max-w-[620px]">
      <span className="block font-mono text-sm text-lilac-2 mb-1.5 truncate">{fileName}</span>
      <pre className="m-0 font-mono text-sm leading-5 text-ink whitespace-pre-wrap break-words max-h-40 overflow-auto">
        {quote ? whole ? <mark>{quote}</mark> : traced(quote, find) : <span className="text-ink-3 font-sans">{empty ?? 'The reader gave no quote for this.'}</span>}
      </pre>
    </div>
  )
}

// A step sentence from the engine ("Per piece: ₹403 / 100 = ₹4.03") as a row: label, as written, result.
export function stepRows(steps: string[]) {
  return steps.map((s) => {
    const colon = s.indexOf(': ')
    const label = colon > 0 && colon < 40 ? s.slice(0, colon) : ''
    const rest = label ? s.slice(colon + 2) : s
    const eq = rest.indexOf(' = ')
    return eq > 0 ? { label, from: rest.slice(0, eq), to: rest.slice(eq + 3) } : { label, from: rest, to: null }
  })
}

// "How code worked it out": label and value rows. The last value is the price, in gold.
export function Work({ rows }: { rows: { label: string; from: string; to?: string | null }[] }) {
  return (
    <dl className="rows text-base">
      {rows.map((r, i) => (
        <div key={i} className="flex justify-between items-baseline gap-4 py-[9px]">
          <dt className="text-ink-2">
            {r.label || 'Step'}
            {r.to && <span className="block text-sm text-ink-3">{r.from}</span>}
          </dt>
          <dd className={`text-right font-semibold whitespace-nowrap ${i === rows.length - 1 && r.to ? 'text-gold' : 'text-ink'}`}>{r.to ?? r.from}</dd>
        </div>
      ))}
    </dl>
  )
}

// A small section label.
export const Sect = ({ children, className = '' }: { children: ReactNode; className?: string }) => <h3 className={`text-lg font-semibold text-sky ${className}`}>{children}</h3>

// Status is always a word. Colour only adds to it.
export function Status({ tone, children, title }: { tone: 'ok' | 'stop' | 'none'; children: ReactNode; title?: string }) {
  const cls = tone === 'ok' ? 'text-ok' : tone === 'stop' ? 'text-stop' : 'text-ink-3'
  return (
    <span className={`font-medium ${cls}`} title={title}>
      {children}
    </span>
  )
}

export const GATE: Record<GateStatus, { tone: 'ok' | 'stop' | 'none'; word: string }> = {
  pass: { tone: 'none', word: 'Passed' },
  fail: { tone: 'stop', word: 'Failed' },
  unclear: { tone: 'stop', word: 'Unclear' },
  not_answered: { tone: 'stop', word: 'No answer' },
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full px-2 h-[19px] text-sm bg-well text-ink-2 whitespace-nowrap">{children}</span>
}

// A modal built on the native dialog element: focus is trapped and Esc closes it.
export function Dialog({ open, onClose, title, children, wide, big }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; big?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-label={title} className={`glass sheet card m-auto p-0 text-ink-2 w-[calc(100vw-2rem)] ${wide ? 'max-w-2xl' : 'max-w-[560px]'}`}>
      {open && (
        <div>
          <div className="flex items-start gap-2 pl-[34px] max-sm:pl-5 pr-4 pt-[26px] pb-1">
            <h2 className={`flex-1 min-w-0 ${big ? 'page-title' : `${CARD_TITLE} truncate`}`}>{title}</h2>
            <Button variant="ghost" icon="x" onClick={onClose} aria-label="Close" className="!px-2.5" />
          </div>
          <div className="px-[34px] max-sm:px-5 pb-[30px] pt-2">{children}</div>
        </div>
      )}
    </dialog>
  )
}

// An empty state says what will appear and gives the one button that gets there.
export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="page-w pt-9 pb-[72px]">
      <div className="glass card px-[30px] max-sm:px-5 py-7 max-w-[640px] mx-auto">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink text-balance">{title}</h1>
        <p className="mt-2 text-lg font-normal text-ink-2">{text}</p>
        {action && <div className="mt-[18px] flex gap-2.5 flex-wrap">{action}</div>}
      </div>
    </div>
  )
}

// An error the buyer can clear with a click: a red glass tile, white text, a white pill.
export function ErrorTile({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="tile px-4 py-3.5" role="alert">
      <div className="text-lg font-semibold">{title}</div>
      {text && <div className="mt-px text-md text-on-tile-2">{text}</div>}
      {children && <div className="mt-3 flex gap-2 flex-wrap">{children}</div>}
    </div>
  )
}

// A plain note with a hairline at its left. `stop` colours the hairline and the words.
export function Note({ tone = 'none', children }: { tone?: 'none' | 'stop'; children: ReactNode }) {
  return <div className={`border-l pl-3 ${tone === 'stop' ? 'border-stop text-stop' : 'border-hair-2 text-ink-2'}`}>{children}</div>
}

// A small menu on the Popover API: light dismiss and Esc come from the browser.
export function useMenu() {
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const place = (side: 'left' | 'right' = 'left') => {
    const r = btn.current?.getBoundingClientRect()
    if (!r || !pop.current) return
    pop.current.style.top = `${r.bottom + 8}px`
    if (side === 'left') pop.current.style.left = `${r.left}px`
    else pop.current.style.right = `${window.innerWidth - r.right}px`
  }
  return { btn, pop, place, close: () => pop.current?.hidePopover() }
}
export const MENU = 'menu glass sheet w-60 rounded-tile p-1.5 text-ink text-base'
export const MENU_ITEM = 'block w-full text-left px-3 py-2 rounded-[10px] hover:bg-well disabled:opacity-40 disabled:pointer-events-none'
