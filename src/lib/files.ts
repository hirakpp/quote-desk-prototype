import * as XLSX from 'xlsx'
// @ts-expect-error mammoth ships no types for its browser build
import mammoth from 'mammoth/mammoth.browser'
import type { Part } from './llm/types.ts'

// Turns a vendor file into provider-neutral parts for the model, in the browser.
// Excel and Word are parsed to text here. PDF and images go to the model as they are.

export interface ParsedFile {
  parts: Part[]
  // The text the model was given, for text formats. Shown in the source viewer.
  docText?: string
  format: string
}

const ext = (name: string) => (name.split('.').pop() ?? '').toLowerCase()

function toBase64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(s)
}

async function imagePart(blob: Blob): Promise<Part> {
  // Phone photos can be large. Scale the long edge down to 2400 px and re-encode as JPEG.
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height))
  const small = blob.size < 3_500_000 && scale === 1 && (blob.type === 'image/jpeg' || blob.type === 'image/png')
  if (small) {
    return { kind: 'image', mediaType: blob.type, base64: toBase64(new Uint8Array(await blob.arrayBuffer())) }
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const data = canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
  return { kind: 'image', mediaType: 'image/jpeg', base64: data }
}

export async function parseFile(blob: Blob, name: string): Promise<ParsedFile> {
  const e = ext(name)
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(e)) {
    const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
    const docText = wb.SheetNames.map((n) => `=== Sheet: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`).join('\n\n')
    return { format: 'Excel', docText, parts: [{ kind: 'text', text: `Spreadsheet contents, one sheet at a time, as CSV:\n\n${docText}` }] }
  }
  if (e === 'docx') {
    const res = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() })
    const docText = String(res.value).trim()
    if (!docText) throw new Error('This Word file has no readable text.')
    return { format: 'Word', docText, parts: [{ kind: 'text', text: `Word document text:\n\n${docText}` }] }
  }
  if (e === 'pdf') {
    if (blob.size > 25_000_000) throw new Error('This PDF is over 25 MB, which is too large to send in one request.')
    return {
      format: 'PDF',
      parts: [{ kind: 'pdf', fileName: name, base64: toBase64(new Uint8Array(await blob.arrayBuffer())) }],
    }
  }
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'].includes(e)) {
    if (e === 'heic') throw new Error('HEIC photos are not supported by this browser path. Export the photo as JPEG and upload again.')
    return { format: 'Photo', parts: [await imagePart(blob)] }
  }
  if (['txt', 'eml', 'md', 'text', 'msg', ''].includes(e)) {
    const docText = (await blob.text()).trim()
    if (!docText) throw new Error('This file is empty.')
    if (docText.includes('\u0000')) throw new Error(`This does not look like a text file (.${e || 'no extension'}). Supported: Excel, Word (.docx), PDF, JPG or PNG photo, text or email.`)
    return { format: 'Email', docText, parts: [{ kind: 'text', text: `Email or text reply:\n\n${docText}` }] }
  }
  throw new Error(`Files of type .${e} are not supported. Supported: Excel, Word (.docx), PDF, JPG or PNG photo, text or email.`)
}
