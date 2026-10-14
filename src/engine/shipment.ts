/**
 * Planning an order of one or more products.
 *
 * Each product fills its own boxes as if it were alone (`planOrder`). What is
 * left over goes in that product's partly filled box, unless mixing the
 * leftovers of several products saves boxes, or volume for the same number of
 * boxes; then they share boxes packed unit by unit (`packMixed`).
 *
 * Then each box of leftovers is emptied into the room the other boxes leave,
 * when all its units fit there (`topUp`): a box another product cannot fill,
 * such as one taking only four large units, often has room beside them. The
 * units already in a box stay where they are.
 */

import { volumeCm3, type BoxFit } from './fit.ts'
import { packMixed, topUp, type BoxRules, type MixedItem, type ToppedUp } from './mixed.ts'
import { placeUnits, type PlacedUnit } from './place.ts'
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
  /**
   * In a box topped up with other products: the product it holds as in its
   * own boxes, arranged the same way, with the others in the room left.
   */
  base: number | null
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
 * Boxes holding more than this many units take no other products: packing
 * around them would be slow, and units that small leave little room anyway.
 */
const HOST_LIMIT = 1000

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
        base: null,
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
        base: null,
      }))
      const separate = pool.map((p) => p.line)
      if (!fewerOrSmaller(mixed, separate)) mixed = null
    }
  }

  const leftovers = mixed
    ? [...partials.filter((p) => !pool.includes(p)).map((p) => p.line), ...mixed]
    : partials.map((p) => p.line)
  lines.push(...leftovers)
  absorb(lines, new Set(leftovers), products, rules)

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

/**
 * Empties boxes of leftovers into the room the other boxes leave, one box at
 * a time, smallest first, as long as one can be emptied. `lines` changes.
 */
function absorb(lines: ShipmentLine[], leftovers: Set<ShipmentLine>, products: Product[], rules: BoxRules) {
  const units = (line: ShipmentLine) => line.contents.reduce((sum, c) => sum + c.units, 0)
  for (let emptied = true; emptied; ) {
    emptied = false
    const candidates = lines.filter((l) => leftovers.has(l)).sort((a, b) => units(a) - units(b))
    for (const from of candidates) {
      if (units(from) > MIX_LIMIT) continue
      const moves = spread(from, lines, products, rules)
      if (!moves) continue
      lines.splice(lines.indexOf(from), 1)
      leftovers.delete(from)
      for (const { line, topped } of moves) {
        const contents = new Map<number, number>()
        for (const u of topped.placed) contents.set(u.product, (contents.get(u.product) ?? 0) + 1)
        const filled: ShipmentLine = {
          box: line.box,
          boxes: 1,
          contents: [...contents].sort((a, b) => a[0] - b[0]).map(([product, n]) => ({ product, units: n })),
          grossKgPerBox: topped.grossKg,
          fit: null,
          placed: topped.placed,
          partial: false,
          base: line.placed ? line.base : line.contents[0].product,
        }
        lines.push(filled)
        // A box of leftovers stays one, so it may still be emptied later.
        if (leftovers.has(line)) leftovers.add(filled)
        line.boxes--
        if (line.boxes === 0) {
          lines.splice(lines.indexOf(line), 1)
          leftovers.delete(line)
        }
      }
      emptied = true
      break
    }
  }

  // Boxes topped up the same way are listed once.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.placed) continue
    const same = JSON.stringify([line.box.id, line.base, line.placed])
    for (let j = lines.length - 1; j > i; j--) {
      const other = lines[j]
      if (other.placed && JSON.stringify([other.box.id, other.base, other.placed]) === same) {
        line.boxes += other.boxes
        lines.splice(j, 1)
      }
    }
  }
}

/**
 * Where the units of box `from` could go instead, filling each time the box
 * with room for the most of them. Null when some would be left over. A box
 * holding one product takes only other products.
 */
function spread(
  from: ShipmentLine,
  lines: ShipmentLine[],
  products: Product[],
  rules: BoxRules,
): Array<{ line: ShipmentLine; topped: ToppedUp }> | null {
  const kind = (product: number, count: number): MixedItem => ({
    product,
    dims: products[product].unit.dims,
    weightKg: products[product].unit.weightKg,
    keepUpright: products[product].keepUpright,
    maxLayers: products[product].maxLayers,
    fragile: products[product].fragile,
    count,
  })
  let guests = from.contents.map((c) => kind(c.product, c.units))
  const moves: Array<{ line: ShipmentLine; topped: ToppedUp }> = []
  // Boxes of each line already chosen.
  const used = new Map<ShipmentLine, number>()

  while (guests.some((g) => g.count > 0)) {
    let best: { line: ShipmentLine; topped: ToppedUp; moved: number } | null = null
    for (const line of lines) {
      if (line === from || (used.get(line) ?? 0) >= line.boxes) continue
      if (line.contents.reduce((sum, c) => sum + c.units, 0) > HOST_LIMIT) continue
      const own = line.placed ? null : line.contents[0].product
      const welcome = guests.map((g) => (g.product === own ? { ...g, count: 0 } : g))
      if (welcome.every((g) => g.count === 0)) continue
      const residents = line.placed ?? placeUnits(line.fit!, line.contents[0].units, own!)
      const kinds = line.contents.map((c) => kind(c.product, 0))
      const topped = topUp(line.box, residents, kinds, welcome, rules)
      const moved = topped.taken.reduce((sum, n) => sum + n, 0)
      if (moved > 0 && (!best || moved > best.moved)) best = { line, topped, moved }
    }
    if (!best) return null
    moves.push({ line: best.line, topped: best.topped })
    used.set(best.line, (used.get(best.line) ?? 0) + 1)
    const { taken } = best.topped
    guests = guests.map((g, k) => ({ ...g, count: g.count - taken[k] }))
  }
  return moves
}

/** Whether `a` uses fewer boxes than `b`, or as many with less volume. */
function fewerOrSmaller(a: ShipmentLine[], b: ShipmentLine[]): boolean {
  const boxes = (lines: ShipmentLine[]) => lines.reduce((sum, l) => sum + l.boxes, 0)
  const volume = (lines: ShipmentLine[]) =>
    lines.reduce((sum, l) => sum + l.boxes * volumeCm3(l.box.dims), 0)
  return boxes(a) < boxes(b) || (boxes(a) === boxes(b) && volume(a) < volume(b))
}
