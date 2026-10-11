import * as XLSX from 'xlsx'
import { awardScenario } from './analysis.ts'
import type { AwardInput } from './analysis.ts'
import { isUnconfirmed } from './normalize.ts'
import type { Cell, Grid } from './types.ts'

const status = (c: Cell) =>
  c.check === 'not_quoted' ? 'not quoted' : c.check === 'no_price' ? 'no usable price' : c.check === 'look' ? 'needs a look' : isUnconfirmed(c) ? 'under a rule not accepted' : 'confirmed'

export function exportGrid(grid: Grid) {
  const wb = XLSX.utils.book_new()
  const unit = grid.lines[0]?.unit ?? 'unit'
  const cur = grid.rfx.currency
  const head = ['Line', 'Description', 'Category', grid.rfx.quantityLabel, `${grid.rfx.refLabel} (${cur}/${unit})`, ...grid.vendors.flatMap((v) => [`${v.name} (${cur}/${unit})`, `${v.name} status`])]
  const rows = grid.lines.map((l) => [
    l.id,
    l.description,
    l.category,
    l.quantity,
    l.refPrice,
    ...grid.vendors.flatMap((v) => {
      const c = grid.cells[v.replyId][l.id]
      return [c.unitPrice, status(c)]
    }),
  ])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), 'Comparison')

  const src = [['Vendor', 'Line', 'Status', `${cur} per ${unit}`, 'Basis', 'Conversion marks', 'As written', 'Unit as written', 'Match', 'Source quote', 'How it was converted', 'Open doubts']]
  for (const v of grid.vendors) {
    for (const l of grid.lines) {
      const c = grid.cells[v.replyId][l.id]
      src.push([
        v.name,
        l.id,
        status(c),
        c.unitPrice as never,
        c.basis ?? '',
        c.marks.join(' '),
        c.rawText ?? '',
        c.unitText ?? '',
        c.match === 'exact' ? '' : `${c.match}: ${c.offered ?? ''}`,
        c.quote ?? '',
        c.steps.join(' | '),
        c.doubts.filter((r) => !r.confirmed).map((r) => r.text).join(' | '),
      ])
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(src), 'Sources')

  const ven = [['Vendor', 'File', 'Read by', 'Lines priced', 'Like-for-like total', 'Total is provisional', 'Freight', 'GST', 'Discount', 'Quality gate', 'Know before you award']]
  for (const v of grid.vendors) {
    ven.push([
      v.name,
      v.fileName,
      v.readBy,
      `${v.linesQuoted} of ${v.totalLines}`,
      v.likeForLike as never,
      v.provisional ? 'yes' : 'no',
      v.freight,
      v.gst,
      v.discount ? `${v.discount.percent}% ${v.discount.applied ? 'applied' : 'not applied'}${v.discount.condition ? `, condition: ${v.discount.condition}` : ''}` : 'none',
      v.gate,
      grid.blockers.filter((b) => b.replyId === v.replyId).map((b) => b.title).join(' | '),
    ])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ven), 'Vendors')

  const rules = [['Vendor', 'Rule', 'What code did', 'Lines', 'Accepted by buyer']]
  for (const r of grid.rules) rules.push([r.vendorName, r.title, r.text, r.lineIds.join(', '), r.accepted ? 'yes' : 'no'])
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rules), 'Rules')

  const qa = [['Question', 'Quality gate', ...grid.vendors.map((v) => v.name)]]
  for (const q of grid.questionnaire) {
    qa.push([
      q.text,
      q.gate ? 'yes' : '',
      ...grid.vendors.map((v) => {
        const a = v.answers[q.id]
        return a?.answered ? `${a.answer ?? ''}${q.gate ? ` [${a.meets_requirement}]` : ''}` : 'not answered'
      }),
    ])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(qa), 'Questionnaire')
  XLSX.writeFile(wb, 'quote-comparison.xlsx')
}

export function exportAward(grid: Grid, scenario: AwardInput) {
  const res = awardScenario(grid, scenario)
  if ('error' in res) throw new Error(res.error)
  const wb = XLSX.utils.book_new()
  const cur = grid.rfx.currency
  // A what-if is labelled as a what-if wherever its number appears, including here.
  const tag = res.what_if ? ' (WHAT-IF, hypothetical)' : ''
  const summary: (string | number | null)[][] = [
    ['Scenario', `${res.name}${tag}`],
    ['Rule', res.rule],
    ...res.what_if_notes.map((n) => ['What-if', n]),
    ['Lines awarded', `${res.lines_awarded} of ${res.lines_total}`],
    [`Total cost (${cur})${tag}`, res.total_cost],
    [`${grid.rfx.refLabel} cost, same lines (${cur})`, res.reference_cost_same_lines],
    [`Saving vs ${grid.rfx.refLabel} (${cur})${tag}`, res.saving_vs_reference],
    [`Saving vs ${grid.rfx.refLabel} (%)`, res.saving_vs_reference_pct],
    ['Best single eligible vendor', res.best_single_eligible_vendor ? `${res.best_single_eligible_vendor.vendor}: ${res.best_single_eligible_vendor.cost}` : 'none covers every awarded line'],
    ['Prices used that the buyer has not confirmed', res.unconfirmed_prices_used],
    [],
    ['Vendor', 'Lines', `Cost (${cur})`, 'Share (%)'],
    ...res.vendors_in_award.map((v) => [v.vendor, v.lines, v.cost, v.share_pct]),
    [],
    ['Excluded vendor', 'Reason'],
    ...res.excluded_vendors.map((v) => [v.vendor, v.reason]),
    [],
    ['Caveats'],
    ...res.caveats.map((c) => [c]),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary')
  const lines = [
    ['Line', 'Description', 'Awarded to', `${cur} per unit`, 'Quantity', `Cost (${cur})`, `${grid.rfx.refLabel} price`, 'Confirmed by buyer'],
    ...res.awards.map((a) => [a.line, a.description, a.vendor, a.unit_price, a.quantity, a.cost, a.reference_price, a.unconfirmed ? 'no' : 'yes']),
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lines), 'Award by line')
  XLSX.writeFile(wb, res.what_if ? 'award-scenario-what-if.xlsx' : 'award-scenario.xlsx')
}
