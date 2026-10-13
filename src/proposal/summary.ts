/** What a proposta keeps of the plan, and whether a plan still matches it. */

import type { ShippingMode } from '../data/shipping.ts'
import { freightWeight, type Shipment } from '../engine/index.ts'
import { count, list, num } from '../ui/format.ts'
import type { ProposalLine, ProposalResult } from './format.ts'

/** "1 caixa CM", or "3 caixas: 2 CM e 1 M" when sizes are mixed. */
export function headline(shipment: Shipment): string {
  const sizes: Array<{ name: string; boxes: number }> = []
  for (const line of shipment.lines) {
    const size = sizes.find((s) => s.name === line.box.name)
    if (size) size.boxes += line.boxes
    else sizes.push({ name: line.box.name, boxes: line.boxes })
  }
  const boxes = count(shipment.totalBoxes, 'caixa', 'caixas')
  return sizes.length === 1
    ? `${boxes} ${sizes[0].name}`
    : `${boxes}: ${list(sizes.map((s) => `${num(s.boxes, 0)} ${s.name}`))}`
}

/** The plan as a proposta keeps it, with products and boxes by name. */
export function summarize(shipment: Shipment, names: string[], mode: ShippingMode): ProposalResult {
  const weights = freightWeight(shipment, mode.cubage)
  return {
    priority: shipment.priority,
    mode: mode.label,
    headline: headline(shipment),
    totalBoxes: shipment.totalBoxes,
    volumeM3: shipment.volumeM3,
    grossKg: shipment.grossKg,
    cubedKg: weights.cubedKg,
    chargeableKg: weights.chargeableKg,
    lines: shipment.lines.map((l) => ({
      box: l.box.name,
      boxes: l.boxes,
      contents: l.contents.map((c) => ({ product: names[c.product], units: c.units })),
      grossKgPerBox: l.grossKgPerBox,
      mixed: l.placed !== null,
    })),
  }
}

/** Whether two plans ship the same boxes with the same contents. */
export function sameBoxes(a: ProposalResult, b: ProposalResult): boolean {
  const key = (lines: ProposalLine[]) =>
    lines
      .map((l) => `${l.boxes}x${l.box}:${l.contents.map((c) => `${c.units} ${c.product}`).join('+')}`)
      .sort()
      .join('|')
  return key(a.lines) === key(b.lines)
}
