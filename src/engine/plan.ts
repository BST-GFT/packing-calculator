/**
 * Choosing boxes for an order.
 *
 * Given how many units each box type holds, pick how many boxes of each type
 * to use so the whole quantity is covered at the lowest total. Box sizes can
 * be mixed. What "lowest" means is the priority:
 *
 *   balanced  total box volume plus a fixed penalty for every box, so one
 *             more box has to save a worthwhile amount of volume
 *   volume    least total box volume shipped, then fewest boxes
 *   boxes     fewest boxes, then least total volume
 *   cost      lowest total cost, when every box has a cost, then fewest boxes
 *
 * This is solved exactly, quantity by quantity: the best way to cover q units
 * is one more box on top of the best way to cover what that box leaves over.
 */

import { grossKg, toMm, volumeCm3, type BoxFit } from './fit.ts'
import type { BoxType } from './types.ts'

export type Priority = 'balanced' | 'volume' | 'boxes' | 'cost'

export interface PlanLine {
  fit: BoxFit
  box: BoxType
  /** Number of boxes on this line. */
  boxes: number
  unitsPerBox: number
  grossKgPerBox: number
  /** True for the single box that is not filled to capacity. */
  partial: boolean
}

export interface Plan {
  priority: Priority
  lines: PlanLine[]
  quantity: number
  totalBoxes: number
  /** Units that would still fit in the boxes chosen. */
  spareUnits: number
  /** Total volume of the boxes shipped. */
  volumeM3: number
  /** Share of that volume taken by product, from 0 to 1. */
  fill: number
  grossKg: number
  /** Total cost, or null when not every box has a cost. */
  costBRL: number | null
}

/** Quantities above this are bulk-filled first so the table stays small. */
const TABLE_LIMIT = 2_000_000

const boxVolumeMm3 = (fit: BoxFit): number =>
  toMm(fit.box.dims.length) * toMm(fit.box.dims.width) * toMm(fit.box.dims.height)

export function hasCosts(fits: BoxFit[]): boolean {
  const usable = fits.filter((f) => f.capacity > 0)
  return usable.length > 0 && usable.every((f) => f.box.costBRL !== undefined)
}

export interface PlanOptions {
  /** For 'balanced': how many litres of box volume one extra box is worth. */
  boxPenaltyLiters?: number
}

export function planOrder(
  fits: BoxFit[],
  quantity: number,
  priority: Priority = 'balanced',
  options: PlanOptions = {},
): Plan | null {
  const usable = fits.filter((f) => f.capacity > 0)
  if (usable.length === 0 || !Number.isInteger(quantity) || quantity < 1) return null
  if (priority === 'cost' && !hasCosts(usable)) priority = 'balanced'

  const penaltyMm3 = Math.round((options.boxPenaltyLiters ?? 0) * 1e6)
  const cap = usable.map((f) => f.capacity)
  const first = usable.map((f) => {
    switch (priority) {
      case 'balanced':
        return boxVolumeMm3(f) + penaltyMm3
      case 'volume':
        return boxVolumeMm3(f)
      case 'boxes':
        return 1
      case 'cost':
        return Math.round((f.box.costBRL ?? 0) * 100)
    }
  })
  const second = usable.map((f) => (priority === 'boxes' ? boxVolumeMm3(f) : 1))

  const counts = new Array<number>(usable.length).fill(0)
  let rest = quantity

  // A very large order is mostly the single most efficient box; only the tail
  // gets the full search, so above this size the result is near-best, not exact.
  if (rest > TABLE_LIMIT) {
    let k = 0
    for (let i = 1; i < usable.length; i++) {
      const mine = first[i] * cap[k]
      const theirs = first[k] * cap[i]
      if (mine < theirs || (mine === theirs && cap[i] > cap[k])) k = i
    }
    const bulk = Math.floor((rest - TABLE_LIMIT / 2) / cap[k])
    counts[k] += bulk
    rest -= bulk * cap[k]
  }

  const bestFirst = new Float64Array(rest + 1)
  const bestSecond = new Float64Array(rest + 1)
  const choice = new Int8Array(rest + 1)
  for (let q = 1; q <= rest; q++) {
    let a = Infinity
    let b = Infinity
    let pick = -1
    for (let i = 0; i < usable.length; i++) {
      const left = q > cap[i] ? q - cap[i] : 0
      const ca = bestFirst[left] + first[i]
      const cb = bestSecond[left] + second[i]
      if (ca < a || (ca === a && cb < b)) {
        a = ca
        b = cb
        pick = i
      }
    }
    bestFirst[q] = a
    bestSecond[q] = b
    choice[q] = pick
  }
  for (let q = rest; q > 0; ) {
    const i = choice[q]
    counts[i]++
    q = q > cap[i] ? q - cap[i] : 0
  }

  let spare = counts.reduce((sum, n, i) => sum + n * cap[i], 0) - quantity

  // The box left partly empty is the smallest one in the mix.
  const smallestUsed = (): number => {
    let p = -1
    for (let i = 0; i < usable.length; i++) {
      if (counts[i] > 0 && (p < 0 || cap[i] < cap[p])) p = i
    }
    return p
  }
  let partialIndex = spare > 0 ? smallestUsed() : -1
  // Cannot happen with positive volumes and costs, but never ship an empty box.
  while (partialIndex >= 0 && spare >= cap[partialIndex]) {
    counts[partialIndex]--
    spare -= cap[partialIndex]
    partialIndex = spare > 0 ? smallestUsed() : -1
  }

  const order = usable.map((_, i) => i).sort((p, q) => boxVolumeMm3(usable[q]) - boxVolumeMm3(usable[p]))
  const lines: PlanLine[] = []
  let partial: PlanLine | null = null
  for (const i of order) {
    if (counts[i] === 0) continue
    const fit = usable[i]
    const isPartial = i === partialIndex
    const full = counts[i] - (isPartial ? 1 : 0)
    if (full > 0) {
      lines.push({
        fit,
        box: fit.box,
        boxes: full,
        unitsPerBox: cap[i],
        grossKgPerBox: grossKg(fit, cap[i]),
        partial: false,
      })
    }
    if (isPartial) {
      const units = cap[i] - spare
      partial = {
        fit,
        box: fit.box,
        boxes: 1,
        unitsPerBox: units,
        grossKgPerBox: grossKg(fit, units),
        partial: true,
      }
    }
  }
  if (partial) lines.push(partial)

  const totalBoxes = lines.reduce((sum, l) => sum + l.boxes, 0)
  const volumeCm = lines.reduce((sum, l) => sum + l.boxes * volumeCm3(l.fit.box.dims), 0)
  const withCosts = lines.every((l) => l.fit.box.costBRL !== undefined)

  return {
    priority,
    lines,
    quantity,
    totalBoxes,
    spareUnits: spare,
    volumeM3: volumeCm / 1e6,
    fill: volumeCm > 0 ? (quantity * volumeCm3(usable[0].unit.dims)) / volumeCm : 0,
    grossKg: lines.reduce((sum, l) => sum + l.boxes * l.grossKgPerBox, 0),
    costBRL: withCosts
      ? lines.reduce((sum, l) => sum + l.boxes * (l.fit.box.costBRL ?? 0), 0)
      : null,
  }
}
