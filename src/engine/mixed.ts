/**
 * Packing several products together, unit by unit.
 *
 * Used for what is left over once each product has filled its own boxes:
 * packed together into shared boxes (`packMixed`), or into the room another
 * box leaves around the units already in it, which stay put (`topUp`).
 * Each unit goes to the lowest free corner that placed units leave (an
 * "extreme point"), then the one furthest back, then furthest left. Each
 * product keeps one way of lying, chosen by trying them all, so its units
 * form neat rows and layers instead of filling gaps every which way.
 *
 * The order of products puts fragile ones on top: every other product goes
 * in first. Light products ride on top of fragile ones only when needed: one
 * of the orders tried puts them after the fragile ones, and it is used when
 * the usual orders cannot fit everything in the box.
 *
 * Every unit must:
 *   - fit in the box without overlapping another,
 *   - rest on the floor, or on units below with at least MIN_SUPPORT of its base,
 *   - respect every layer limit below it: a unit whose product allows m layers
 *     has at most m − 1 units stacked above it, whatever their product,
 *   - not overload a fragile unit: the weight of other products resting on it,
 *     directly or through the units between, stays within `fragileFactor`
 *     times its own weight. A fragile unit of unknown weight carries no other
 *     product,
 *   - keep the box within its weight limit.
 *
 * Weight is passed down in proportion to how much of a unit's base rests on
 * each unit below. A few packing orders are tried and the most compact result
 * is kept. All lengths here are whole millimetres.
 */

import { toMm, volumeCm3 } from './fit.ts'
import type { PlacedUnit } from './place.ts'
import { MIN_SUPPORT } from './support.ts'
import type { BoxType, Dims } from './types.ts'

export interface MixedItem {
  /** Index of the product in the order. */
  product: number
  dims: Dims
  weightKg: number
  keepUpright: boolean
  /** Most units stacked one on another, counting this one; Infinity for no limit. */
  maxLayers: number
  /** Goes on top of the other products and carries only light ones. */
  fragile: boolean
  /** Units to place. */
  count: number
}

/** The packing rules that apply to every box. */
export interface BoxRules {
  lossCm: number
  maxGrossKg: number
  protectionKg: number
  /** How many times its own weight a fragile unit with no layer limit can carry in other products. */
  fragileLoad: number
}

/**
 * How many times its own weight a fragile unit can carry in other products.
 * With a layer limit m, as much as the m − 1 units of its own it may carry;
 * without one, `fragileLoad`.
 */
export const fragileFactor = (maxLayers: number, fragileLoad: number): number =>
  Number.isFinite(maxLayers) ? maxLayers - 1 : fragileLoad

export interface MixedBox {
  box: BoxType
  /** Units in placing order, bottom layers first. */
  placed: PlacedUnit[]
  /** Units of each product in the box, in product order. */
  contents: Array<{ product: number; units: number }>
  grossKg: number
}

interface Placed {
  item: number
  x: number
  y: number
  z: number
  dx: number
  dy: number
  dz: number
  /** 1 on the floor, one more than the highest unit it rests on otherwise. */
  level: number
  /** Highest level allowed above this unit by its own limit and those below it. */
  ceiling: number
  /** The units this one rests on, with the share of its weight each takes. */
  under: Array<[number, number]>
  /** Weight of other products resting on this unit, kg. */
  load: number
}

type Shape = [number, number, number]

/** Units already in the box when packing starts, as solid blocks, and their weight. */
interface Start {
  blocks: Placed[]
  weightKg: number
}

const EMPTY: Start = { blocks: [], weightKg: 0 }

interface Packing {
  /** The blocks the packing started from, then the units placed. */
  placed: Placed[]
  /** Units left over, per item. */
  left: number[]
  heightMm: number
}

interface Strategy {
  /** Order of products within the same group. */
  order: (a: MixedItem, b: MixedItem) => number
  /** Which way to fill a level first: along the width (y) or the length (x). */
  rowsAlong: 'length' | 'width'
  /** Pack light products after the fragile ones, so they may go on top of them. */
  lightOnFragile: boolean
  /** Each product keeps one way of lying; otherwise every unit turns freely. */
  oneWay: boolean
}

const unitVolume = (i: MixedItem) => volumeCm3(i.dims)
const ORDERS: Array<Omit<Strategy, 'oneWay'>> = [
  { order: (a, b) => unitVolume(b) - unitVolume(a), rowsAlong: 'length', lightOnFragile: false },
  { order: (a, b) => unitVolume(b) - unitVolume(a), rowsAlong: 'width', lightOnFragile: false },
  { order: (a, b) => b.count - a.count, rowsAlong: 'length', lightOnFragile: false },
  { order: (a, b) => unitVolume(b) - unitVolume(a), rowsAlong: 'length', lightOnFragile: true },
]
// Neat packing first. Units turning freely fill gaps better now and then, so
// those orders are tried when the neat ones leave something out.
const STRATEGIES: Strategy[] = [
  ...ORDERS.map((s) => ({ ...s, oneWay: true })),
  ...ORDERS.map((s) => ({ ...s, oneWay: false })),
]

/** Recent results, since the page plans the same leftovers for several priorities. */
const recent = new Map<string, MixedBox[] | null>()
const RECENT = 20

/**
 * Packs `items` into as few boxes as possible, each the smallest of `boxes`
 * that holds its share. Returns null when some unit fits in no box. The
 * result may be shared with other calls, so it must not be changed.
 */
export function packMixed(items: MixedItem[], boxes: BoxType[], rules: BoxRules): MixedBox[] | null {
  const key = JSON.stringify([items, boxes, rules])
  if (recent.has(key)) return recent.get(key)!
  const result = pack(items, boxes, rules)
  recent.set(key, result)
  if (recent.size > RECENT) recent.delete(recent.keys().next().value!)
  return result
}

function pack(items: MixedItem[], boxes: BoxType[], rules: BoxRules): MixedBox[] | null {
  const bySize = [...boxes].sort((a, b) => volumeCm3(a.dims) - volumeCm3(b.dims))
  if (bySize.length === 0) return []

  for (const box of bySize) {
    const packing = bestPacking(items, box, rules)
    if (packing.left.every((n) => n === 0)) return [toMixedBox(items, box, packing, rules)]
  }

  // Too much for one box: fill the largest, then shrink it to the smallest box
  // that takes what went in, and carry on with the rest.
  const largest = bySize[bySize.length - 1]
  const result: MixedBox[] = []
  let pending = items
  while (pending.some((i) => i.count > 0)) {
    const packing = bestPacking(pending, largest, rules)
    if (packing.placed.length === 0) return null
    const taken = pending.map((i, k) => ({ ...i, count: i.count - packing.left[k] }))
    let chosen = { box: largest, packing, items: pending }
    for (const box of bySize) {
      if (box === largest) break
      const smaller = bestPacking(taken, box, rules)
      if (smaller.left.every((n) => n === 0)) {
        chosen = { box, packing: smaller, items: taken }
        break
      }
    }
    result.push(toMixedBox(chosen.items, chosen.box, chosen.packing, rules))
    pending = pending.map((i, k) => ({ ...i, count: packing.left[k] }))
  }
  return result
}

/** The first order that fits everything; failing that, most units placed, then the lowest stack. */
function bestPacking(items: MixedItem[], box: BoxType, rules: BoxRules, start = EMPTY): Packing {
  let best: Packing | null = null
  for (const strategy of STRATEGIES) {
    const packing = packOnce(items, box, rules, strategy, start)
    const better =
      !best ||
      packing.placed.length > best.placed.length ||
      (packing.placed.length === best.placed.length && packing.heightMm < best.heightMm)
    if (better) best = packing
    // Everything fits: keep the first order that manages it, the neatest.
    if (packing.left.every((n) => n === 0)) return packing
  }
  return best!
}

function packOnce(
  items: MixedItem[],
  box: BoxType,
  rules: BoxRules,
  strategy: Strategy,
  start: Start,
): Packing {
  const room = {
    x: toMm(box.dims.length - rules.lossCm),
    y: toMm(box.dims.width - rules.lossCm),
    z: toMm(box.dims.height - rules.lossCm),
  }
  const weightRoom =
    Math.min(rules.maxGrossKg, box.maxWeightKg ?? Infinity) - box.emptyWeightKg - rules.protectionKg
  const capacity = (i: MixedItem) =>
    i.fragile ? fragileFactor(i.maxLayers, rules.fragileLoad) * i.weightKg : Infinity

  // Other products first, then fragile ones (and those carrying nothing at
  // all); in the fallback order, products light enough for a fragile one last.
  const group = (i: MixedItem) => {
    if (i.fragile || i.maxLayers <= 1) return 1
    const light =
      i.weightKg > 0 &&
      items.some((f) => f.fragile && f.product !== i.product && i.weightKg <= capacity(f))
    return light && strategy.lightOnFragile ? 2 : 0
  }
  const order = items
    .map((_, i) => i)
    .sort(
      (a, b) =>
        group(items[a]) - group(items[b]) ||
        strategy.order(items[a], items[b]) ||
        items[a].product - items[b].product,
    )

  // Loads change as units go in, so the blocks are copied.
  const placed: Placed[] = start.blocks.map((b) => ({ ...b }))
  const left = items.map((i) => i.count)
  let points: Array<{ x: number; y: number; z: number }> = [{ x: 0, y: 0, z: 0 }]
  let weight = start.weightKg

  // Lowest first, then by rows in the chosen direction.
  const rank = (p: { x: number; y: number; z: number }) =>
    strategy.rowsAlong === 'length' ? [p.z, p.y, p.x] : [p.z, p.x, p.y]
  const before = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

  const collides = (x: number, y: number, z: number, s: Shape) =>
    placed.some(
      (q) =>
        x < q.x + q.dx && q.x < x + s[0] &&
        y < q.y + q.dy && q.y < y + s[1] &&
        z < q.z + q.dz && q.z < z + s[2],
    )

  /** How a unit of `item` would rest at this spot, or null if it cannot. */
  const rest = (item: MixedItem, x: number, y: number, z: number, s: Shape) => {
    if (z === 0) return { level: 1, ceiling: item.maxLayers, under: [] as Array<[number, number]> }
    const touching: Array<[number, number]> = []
    let covered = 0
    let below = 0
    let ceiling = Infinity
    placed.forEach((q, i) => {
      if (q.z + q.dz !== z) return
      const ox = Math.min(x + s[0], q.x + q.dx) - Math.max(x, q.x)
      if (ox <= 0) return
      const oy = Math.min(y + s[1], q.y + q.dy) - Math.max(y, q.y)
      if (oy <= 0) return
      touching.push([i, ox * oy])
      covered += ox * oy
      below = Math.max(below, q.level)
      ceiling = Math.min(ceiling, q.ceiling)
    })
    if (covered < MIN_SUPPORT * s[0] * s[1]) return null
    const level = below + 1
    if (level > ceiling) return null
    return {
      level,
      ceiling: Math.min(ceiling, level + item.maxLayers - 1),
      under: touching.map(([i, area]): [number, number] => [i, area / covered]),
    }
  }

  /**
   * The weight a unit of `item` would add to each unit below it, or null if
   * that would overload a fragile unit of another product.
   */
  const loads = (item: MixedItem, under: Array<[number, number]>) => {
    const added = new Map<number, number>()
    const pass = (i: number, kg: number) => {
      added.set(i, (added.get(i) ?? 0) + kg)
      for (const [j, share] of placed[i].under) pass(j, kg * share)
    }
    for (const [i, share] of under) pass(i, item.weightKg * share)
    for (const [i, kg] of added) {
      const q = placed[i]
      const carrier = items[q.item]
      if (!carrier.fragile || carrier.product === item.product) continue
      if (item.weightKg <= 0 || q.load + kg > capacity(carrier) + 1e-9) return null
    }
    return added
  }

  // The nearest surface below, behind or to the left of a point.
  const down = (x: number, y: number, z: number) => {
    let to = 0
    for (const q of placed) {
      const top = q.z + q.dz
      if (top <= z && top > to && q.x <= x && x < q.x + q.dx && q.y <= y && y < q.y + q.dy) to = top
    }
    return to
  }
  const back = (x: number, y: number, z: number) => {
    let to = 0
    for (const q of placed) {
      const face = q.y + q.dy
      if (face <= y && face > to && q.x <= x && x < q.x + q.dx && q.z <= z && z < q.z + q.dz) to = face
    }
    return to
  }
  const leftOf = (x: number, y: number, z: number) => {
    let to = 0
    for (const q of placed) {
      const face = q.x + q.dx
      if (face <= x && face > to && q.y <= y && y < q.y + q.dy && q.z <= z && z < q.z + q.dz) to = face
    }
    return to
  }

  const addPoints = (u: Placed) => {
    const fresh = [
      { x: u.x + u.dx, y: u.y, z: u.z },
      { x: u.x + u.dx, y: u.y, z: down(u.x + u.dx, u.y, u.z) },
      { x: u.x + u.dx, y: back(u.x + u.dx, u.y, u.z), z: u.z },
      { x: u.x, y: u.y + u.dy, z: u.z },
      { x: u.x, y: u.y + u.dy, z: down(u.x, u.y + u.dy, u.z) },
      { x: leftOf(u.x, u.y + u.dy, u.z), y: u.y + u.dy, z: u.z },
      { x: u.x, y: u.y, z: u.z + u.dz },
      { x: leftOf(u.x, u.y, u.z + u.dz), y: u.y, z: u.z + u.dz },
      { x: u.x, y: back(u.x, u.y, u.z + u.dz), z: u.z + u.dz },
    ]
    const inside = (p: { x: number; y: number; z: number }) =>
      u.x <= p.x && p.x < u.x + u.dx && u.y <= p.y && p.y < u.y + u.dy && u.z <= p.z && p.z < u.z + u.dz
    const seen = new Set<string>()
    points = [...points, ...fresh].filter((p) => {
      if (p.x >= room.x || p.y >= room.y || p.z >= room.z || inside(p)) return false
      const key = `${p.x},${p.y},${p.z}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    points.sort((a, b) => before(rank(a), rank(b)))
  }
  for (const block of placed) addPoints(block)

  /** Places as many units of item `index` as fit, turned only in the given ways. */
  const placeAll = (index: number, shapes: Shape[]) => {
    const item = items[index]
    // Spots where no orientation of this item fits stay that way while it is packed.
    const blocked = new Set<string>()
    let lastShape = -1

    while (left[index] > 0 && weight + item.weightKg <= weightRoom + 1e-9) {
      let spot: { unit: Placed; shape: number; added: Map<number, number> } | null = null
      for (const p of points) {
        const key = `${p.x},${p.y},${p.z}`
        if (blocked.has(key)) continue
        let open = false
        for (let s = 0; s < shapes.length; s++) {
          const shape = shapes[s]
          if (p.x + shape[0] > room.x || p.y + shape[1] > room.y || p.z + shape[2] > room.z) continue
          if (collides(p.x, p.y, p.z, shape)) continue
          open = true
          const resting = rest(item, p.x, p.y, p.z, shape)
          if (!resting) continue
          const added = loads(item, resting.under)
          if (!added) continue
          // At the same spot, keep the orientation used last, then the flattest.
          const preferred =
            !spot ||
            (s === lastShape && spot.shape !== lastShape) ||
            (spot.shape !== lastShape && shape[2] < spot.unit.dz)
          if (preferred) {
            spot = {
              unit: { item: index, x: p.x, y: p.y, z: p.z, dx: shape[0], dy: shape[1], dz: shape[2], ...resting, load: 0 },
              shape: s,
              added,
            }
          }
        }
        if (!open) blocked.add(key)
        if (spot) break
      }
      if (!spot) break
      for (const [i, kg] of spot.added) {
        if (items[placed[i].item].product !== item.product) placed[i].load += kg
      }
      placed.push(spot.unit)
      weight += item.weightKg
      left[index]--
      lastShape = spot.shape
      addPoints(spot.unit)
    }
  }

  // Each product is packed lying one way, as a person would, unless mixing
  // orientations does better. Every way is tried from the same starting point;
  // the one that places the most units wins, then the lowest pile, then the
  // one leaving the most floor free for what comes next.
  for (const index of order) {
    if (left[index] === 0) continue
    const choices = strategy.oneWay ? layings(items[index]) : [orientations(items[index])]
    if (choices.length === 1) {
      placeAll(index, choices[0])
      continue
    }
    const start = { count: placed.length, points, loads: placed.map((u) => u.load), left: left[index], weight }
    let best: { score: number[]; units: Placed[]; loads: number[]; points: typeof points; left: number; weight: number } | null = null
    for (const shapes of choices) {
      placeAll(index, shapes)
      const mine = placed.slice(start.count)
      const score = [
        -mine.length,
        placed.reduce((h, u) => Math.max(h, u.z + u.dz), 0),
        mine.reduce((area, u) => area + (u.z === 0 ? u.dx * u.dy : 0), 0),
      ]
      if (!best || before(score, best.score) < 0) {
        best = { score, units: mine, loads: placed.map((u) => u.load), points, left: left[index], weight }
      }
      // Back to where this product started, for the next way to try.
      placed.length = start.count
      start.loads.forEach((load, i) => (placed[i].load = load))
      points = start.points
      left[index] = start.left
      weight = start.weight
    }
    placed.push(...best!.units)
    best!.loads.forEach((load, i) => (placed[i].load = load))
    points = best!.points
    left[index] = best!.left
    weight = best!.weight
  }

  return {
    placed,
    left,
    heightMm: placed.reduce((h, u) => Math.max(h, u.z + u.dz), 0),
  }
}

/** The ways a unit can be turned: any, or only around the vertical when kept upright. */
function orientations(item: MixedItem): Shape[] {
  const l = toMm(item.dims.length)
  const w = toMm(item.dims.width)
  const h = toMm(item.dims.height)
  const all: Shape[] = item.keepUpright
    ? [[l, w, h], [w, l, h]]
    : [[l, w, h], [w, l, h], [l, h, w], [h, l, w], [w, h, l], [h, w, l]]
  return all.filter((s, i) => all.findIndex((t) => t[0] === s[0] && t[1] === s[1] && t[2] === s[2]) === i)
}

/**
 * The ways to pack a product: lying on each of its faces (turning only around
 * the vertical), then free to turn any way. A unit kept upright, or a cube,
 * has just one.
 */
function layings(item: MixedItem): Shape[][] {
  const all = orientations(item)
  const heights = [...new Set(all.map((s) => s[2]))]
  if (heights.length === 1) return [all]
  return [...heights.map((h) => all.filter((s) => s[2] === h)), all]
}

function toMixedBox(items: MixedItem[], box: BoxType, packing: Packing, rules: BoxRules): MixedBox {
  const placed: PlacedUnit[] = packing.placed
    .map((u) => ({
      at: { length: u.x, width: u.y, height: u.z },
      size: { length: u.dx, width: u.dy, height: u.dz },
      layer: u.level - 1,
      turned: false,
      product: items[u.item].product,
    }))
    .sort((a, b) => a.layer - b.layer || a.at.height - b.at.height)

  const units = new Map<number, number>()
  let weight = 0
  for (const u of packing.placed) {
    const item = items[u.item]
    units.set(item.product, (units.get(item.product) ?? 0) + 1)
    weight += item.weightKg
  }
  return {
    box,
    placed,
    contents: [...units].sort((a, b) => a[0] - b[0]).map(([product, n]) => ({ product, units: n })),
    grossKg: box.emptyWeightKg + rules.protectionKg + weight,
  }
}

/** Packing into boxes that already hold units, since the page plans the same boxes several times. */
const recentTopUps = new Map<string, ToppedUp>()

/** Above this many pieces, packing around what a box holds is skipped as too slow. */
const MAX_BLOCKS = 200

export interface ToppedUp {
  /** Every unit in the box, those already there and the guests, bottom layers first. */
  placed: PlacedUnit[]
  /** Units placed of each guest, in the order given. */
  taken: number[]
  grossKg: number
}

/**
 * Puts as many `guests` as fit into the room a box leaves around the units
 * already in it, which stay where they are: beside them, or on top within
 * every rule above, the residents' layer limits and fragility included.
 * `kinds` describes the products of `residents`. The result may be shared
 * with other calls, so it must not be changed.
 */
export function topUp(
  box: BoxType,
  residents: PlacedUnit[],
  kinds: MixedItem[],
  guests: MixedItem[],
  rules: BoxRules,
): ToppedUp {
  const key = JSON.stringify([box, residents, kinds, guests, rules])
  const known = recentTopUps.get(key)
  if (known) return known

  const residentKg = residents.reduce(
    (sum, u) => sum + kinds.find((k) => k.product === u.product)!.weightKg,
    0,
  )
  let result: ToppedUp = {
    placed: residents,
    taken: guests.map(() => 0),
    grossKg: box.emptyWeightKg + rules.protectionKg + residentKg,
  }
  const { blocks, levels } = blocksOf(residents, kinds)
  if (blocks.length <= MAX_BLOCKS && guests.some((g) => g.count > 0)) {
    // The residents' products come first, with nothing left to place.
    const items = [...kinds.map((k) => ({ ...k, count: 0 })), ...guests]
    const packing = bestPacking(items, box, rules, { blocks, weightKg: residentKg })
    const taken = guests.map((g, k) => g.count - packing.left[kinds.length + k])
    const added: PlacedUnit[] = packing.placed.slice(blocks.length).map((u) => ({
      at: { length: u.x, width: u.y, height: u.z },
      size: { length: u.dx, width: u.dy, height: u.dz },
      layer: u.level - 1,
      turned: false,
      product: items[u.item].product,
    }))
    result = {
      placed: [...residents.map((u, i) => ({ ...u, layer: levels[i] - 1 })), ...added].sort(
        (a, b) => a.layer - b.layer || a.at.height - b.at.height,
      ),
      taken,
      grossKg: result.grossKg + guests.reduce((sum, g, k) => sum + taken[k] * g.weightKg, 0),
    }
  }
  recentTopUps.set(key, result)
  if (recentTopUps.size > RECENT) recentTopUps.delete(recentTopUps.keys().next().value!)
  return result
}

/**
 * The units already in a box as solid blocks to pack around: units resting
 * exactly on one another merge into columns, and equal columns side by side
 * into rows, so a full box is a handful of pieces rather than hundreds. Also
 * gives each unit its level, counted from the floor.
 */
function blocksOf(units: PlacedUnit[], kinds: MixedItem[]): { blocks: Placed[]; levels: number[] } {
  const kindOf = new Map(kinds.map((k, i) => [k.product, i]))
  interface Column {
    item: number
    x: number
    y: number
    z: number
    dx: number
    dy: number
    dz: number
    /** The units in it, bottom first. */
    members: number[]
  }

  // Columns: units of one product with the same footprint, one right on another.
  const stacks = new Map<string, number[]>()
  units.forEach((u, i) => {
    const key = [u.product, u.at.length, u.at.width, u.size.length, u.size.width].join('|')
    const stack = stacks.get(key)
    if (stack) stack.push(i)
    else stacks.set(key, [i])
  })
  const columns: Column[] = []
  for (const stack of stacks.values()) {
    stack.sort((a, b) => units[a].at.height - units[b].at.height)
    let column: Column | null = null
    for (const i of stack) {
      const u = units[i]
      if (column && column.z + column.dz === u.at.height) {
        column.dz += u.size.height
        column.members.push(i)
      } else {
        column = {
          item: kindOf.get(u.product)!,
          x: u.at.length,
          y: u.at.width,
          z: u.at.height,
          dx: u.size.length,
          dy: u.size.width,
          dz: u.size.height,
          members: [i],
        }
        columns.push(column)
      }
    }
  }

  // Levels, bottom up: a column starts one above the highest it rests on.
  columns.sort((a, b) => a.z - b.z)
  const levels = new Array<number>(units.length).fill(1)
  const tops: number[] = []
  const ceilings: number[] = []
  columns.forEach((c, i) => {
    let below = 0
    let ceiling = Infinity
    for (let j = 0; j < i; j++) {
      const q = columns[j]
      if (q.z + q.dz !== c.z || overlap(c, q) === 0) continue
      below = Math.max(below, tops[j])
      ceiling = Math.min(ceiling, ceilings[j])
    }
    const first = below + 1
    c.members.forEach((m, k) => (levels[m] = first + k))
    tops[i] = first + c.members.length - 1
    ceilings[i] = Math.min(ceiling, first + kinds[c.item].maxLayers - 1)
  })

  let blocks: Placed[] = columns.map((c, i) => ({
    item: c.item,
    x: c.x,
    y: c.y,
    z: c.z,
    dx: c.dx,
    dy: c.dy,
    dz: c.dz,
    level: tops[i],
    ceiling: ceilings[i],
    under: [],
    load: 0,
  }))
  blocks = joinRows(joinRows(blocks, 'x'), 'y')

  // What each block rests on, with the share of its weight each takes.
  blocks.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x)
  for (const b of blocks) {
    if (b.z === 0) continue
    const touching: Array<[number, number]> = []
    let covered = 0
    blocks.forEach((q, j) => {
      if (q.z + q.dz !== b.z) return
      const area = overlap(b, q)
      if (area > 0) {
        touching.push([j, area])
        covered += area
      }
    })
    b.under = touching.map(([j, area]): [number, number] => [j, area / covered])
  }
  return { blocks, levels }
}

/** Area two pieces share seen from above, mm². */
function overlap(
  a: { x: number; y: number; dx: number; dy: number },
  b: { x: number; y: number; dx: number; dy: number },
): number {
  const ox = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y)
  return ox > 0 && oy > 0 ? ox * oy : 0
}

/** Joins blocks that touch end to end along `along` and match in everything else. */
function joinRows(blocks: Placed[], along: 'x' | 'y'): Placed[] {
  const across = along === 'x' ? 'y' : 'x'
  const length = along === 'x' ? 'dx' : 'dy'
  const width = along === 'x' ? 'dy' : 'dx'
  const rows = new Map<string, Placed[]>()
  for (const b of blocks) {
    const key = [b.item, b.level, b.ceiling, b.z, b.dz, b[across], b[width]].join('|')
    const row = rows.get(key)
    if (row) row.push(b)
    else rows.set(key, [b])
  }
  const joined: Placed[] = []
  for (const row of rows.values()) {
    row.sort((a, b) => a[along] - b[along])
    let current: Placed | null = null
    for (const b of row) {
      if (current && current[along] + current[length] === b[along]) {
        current[length] += b[length]
      } else {
        current = { ...b }
        joined.push(current)
      }
    }
  }
  return joined
}
