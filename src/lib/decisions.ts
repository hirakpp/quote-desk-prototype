import { cellKey } from './normalize.ts'
import type { Decisions } from './types.ts'

// Every buyer decision is a small pure change, and every one can be undone.

export const acceptRule = (d: Decisions, ruleId: string, on: boolean): Decisions => ({ ...d, rules: { ...d.rules, [ruleId]: on } })

// A conditional discount: true applies it, false keeps the list price, undefined puts the choice back to open.
export function chooseDiscount(d: Decisions, replyId: string, applied: boolean | undefined): Decisions {
  const { [replyId]: _drop, ...rest } = d.discount
  return { ...d, discount: applied === undefined ? rest : { ...rest, [replyId]: applied } }
}

export function confirmDoubts(d: Decisions, replyId: string, lineId: string, codes: string[]): Decisions {
  const k = cellKey(replyId, lineId)
  return { ...d, doubts: { ...d.doubts, [k]: [...new Set([...(d.doubts[k] ?? []), ...codes])] } }
}

export function unconfirmDoubts(d: Decisions, replyId: string, lineId: string): Decisions {
  const { [cellKey(replyId, lineId)]: _drop, ...rest } = d.doubts
  return { ...d, doubts: rest }
}

export function setOverride(d: Decisions, replyId: string, lineId: string, value: number | null): Decisions {
  const k = cellKey(replyId, lineId)
  const { [k]: _drop, ...rest } = d.overrides
  return { ...d, overrides: value == null ? rest : { ...rest, [k]: value } }
}

export const setNoted = (d: Decisions, blockerId: string, on: boolean): Decisions => ({ ...d, noted: { ...d.noted, [blockerId]: on } })
