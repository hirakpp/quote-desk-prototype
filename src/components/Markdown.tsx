import type { ReactNode } from 'react'

// Small markdown renderer for chat answers: paragraphs, headings, bullets, bold, code, pipe tables.

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="bg-well px-1 rounded">{p.slice(1, -1)}</code>
    return p
  })
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (line.trim().startsWith('|') && lines[i + 1] && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = cells(line)
      const body: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) body.push(cells(lines[i++]))
      out.push(
        <div key={out.length} className="overflow-x-auto my-2">
          <table className="text-md border-collapse">
            <thead>
              <tr>{head.map((h, k) => <th key={k} className="border-b border-hair-2 px-2 py-1 text-left font-medium">{inline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, k) => (
                <tr key={k}>{r.map((c, j) => <td key={j} className="border border-hair px-2 py-1 num">{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      out.push(<div key={out.length} className="font-semibold mt-3 mb-1">{inline(h[2])}</div>)
      i++
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''))
      out.push(
        <ul key={out.length} className="list-disc pl-5 my-1 space-y-0.5">
          {items.map((it, k) => <li key={k}>{inline(it)}</li>)}
        </ul>,
      )
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !lines[i].trim().startsWith('|') && !/^#{1,4}\s/.test(lines[i])) para.push(lines[i++])
    if (para.length === 0) para.push(lines[i++])
    out.push(<p key={out.length} className="my-1.5">{inline(para.join(' '))}</p>)
  }
  return <div className="text-base leading-relaxed text-ink-2">{out}</div>
}
