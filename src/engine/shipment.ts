/**
 * Planning an order of one or more products.
 *
 * Each product fills its own boxes as if it were alone (`planOrder`). What is
 * left over goes in that product's partly filled box, unless mixing the
 * leftovers of several products saves boxes, or volume for the same number of
 * boxes; then they share boxes packed unit by unit (`packMixed`).
 */

import { volumeCm3, type BoxFit } from './fit.ts'
import { packMixed, type BoxRules, type MixedItem } from './mixed.ts'
import type { PlacedUnit } from './place.ts'
import { planOrder, type Plan, type PlanOptions, type Priority } from './plan.ts'
import type { BoxType, Unit } from './types.ts'

export interface Product {
  unit: Unit
  quantity: number
  keepUpright: boolean
  /** Most units stacked one on another; Infinity for no limit. */
  maxLayers: number
  /** Goes on top of the other products in a mixed box and carries only light ones. */
  fragile: boolean
}

export interface ShipmentLine {
  box: BoxType
  /** Identical boxes on this line. */
  boxes: number
  /** Units of each product in one box, in product order. */
  contents: Array<{ product: number; units: number }>
  grossKgPerBox: number
  /** The layout of a box holding one product. */
  fit: BoxFit | null
  /** Where each unit goes in a box mixing products. */
  placed: PlacedUnit[] | null
  /** A one-product box not filled to capacity. */
  partial: boolean
}

export interface Shipment {
  priority: Priority
  lines: ShipmentLine[]
  totalBoxes: number
  /** Units that would still fit, with a single product; null with several. */
  spareUnits: number | null
  volumeM3: number
  /** Share of the box volume taken by product, from 0 to 1. */
  fill: number
  grossKg: number
  costBRL: number | null
}

/** Leftovers above this many units in all stay in their own boxes, to keep packing quick. */
const MIX_LIMIT = 400

/**
 * Plans the order. `fits[p]` holds product p's fit in each box in use, in
 * the same box order for every product. Null when some product cannot be
 * planned (no quantity, or it fits in no box).
 */
export function planShipment(
  products: Product[],
  fits: BoxFit[][],
  priority: Priority,
  rules: BoxRules,
  options: PlanOptions = {},
): Shipment | null {
  const plans: Plan[] = []
  for (let p = 0; p < products.length; p++) {
    const plan = planOrder(fits[p], products[p].quantity, priority, options)
    if (!plan) return null
    plans.push(plan)
  }

  const lines: ShipmentLine[] = []
  const partials: Array<{ product: number; line: ShipmentLine }> = []
  plans.forEach((plan, product) => {
    for (const l of plan.lines) {
      const line: ShipmentLine = {
        box: l.box,
        boxes: l.boxes,
        contents: [{ product, units: l.unitsPerBox }],
        grossKgPerBox: l.grossKgPerBox,
        fit: l.fit,
        placed: null,
        partial: l.partial,
      }
      if (l.partial) partials.push({ product, line })
      else lines.push(line)
    }
  })

  // The smallest leftovers are mixed first, up to the limit.
  const pool: typeof partials = []
  let pooled = 0
  for (const p of [...partials].sort((a, b) => a.line.contents[0].units - b.line.contents[0].units)) {
    if (pooled + p.line.contents[0].units > MIX_LIMIT) break
    pool.push(p)
    pooled += p.line.contents[0].units
  }

  let mixed: ShipmentLine[] | null = null
  if (pool.length >= 2) {
    const items: MixedItem[] = pool.map(({ product, line }) => ({
      product,
      dims: products[product].unit.dims,
      weightKg: products[product].unit.weightKg,
      keepUpright: products[product].keepUpright,
      maxLayers: products[product].maxLayers,
      fragile: products[product].fragile,
      count: line.contents[0].units,
    }))
    const packed = packMixed(items, fits[0].map((f) => f.box), rules)
    if (packed) {
      mixed = packed.map((m) => ({
        box: m.box,
        boxes: 1,
        contents: m.contents,
        grossKgPerBox: m.grossKg,
        fit: null,
        placed: m.placed,
        partial: false,
      }))
      const separate = pool.map((p) => p.line)
      if (!fewerOrSmaller(mixed, separate)) mixed = null
    }
  }

  if (mixed) {
    lines.push(...partials.filter((p) => !pool.includes(p)).map((p) => p.line), ...mixed)
  } else {
    lines.push(...partials.map((p) => p.line))
  }

  const totalBoxes = lines.reduce((sum, l) => sum + l.boxes, 0)
  const volumeCm = lines.reduce((sum, l) => sum + l.boxes * volumeCm3(l.box.dims), 0)
  const productCm = products.reduce((sum, p) => sum + p.quantity * volumeCm3(p.unit.dims), 0)
  const withCosts = lines.every((l) => l.box.costBRL !== undefined)
  return {
    priority: plans[0].priority,
    lines,
    totalBoxes,
    spareUnits: products.length === 1 ? plans[0].spareUnits : null,
    volumeM3: volumeCm / 1e6,
    fill: volumeCm > 0 ? productCm / volumeCm : 0,
    grossKg: lines.reduce((sum, l) => sum + l.boxes * l.grossKgPerBox, 0),
    costBRL: withCosts ? lines.reduce((sum, l) => sum + l.boxes * (l.box.costBRL ?? 0), 0) : null,
  }
}

/** Whether `a` uses fewer boxes than `b`, or as many with less volume. */
function fewerOrSmaller(a: ShipmentLine[], b: ShipmentLine[]): boolean {
  const boxes = (lines: ShipmentLine[]) => lines.reduce((sum, l) => sum + l.boxes, 0)
  const volume = (lines: ShipmentLine[]) =>
    lines.reduce((sum, l) => sum + l.boxes * volumeCm3(l.box.dims), 0)
  return boxes(a) < boxes(b) || (boxes(a) === boxes(b) && volume(a) < volume(b))
}
