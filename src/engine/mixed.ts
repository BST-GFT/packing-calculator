/**
 * Packing several products together, unit by unit.
 *
 * Used for what is left over once each product has filled its own boxes.
 * Each unit goes to the lowest free corner that placed units leave (an
 * "extreme point"), then the one furthest back, then furthest left, in
 * whichever allowed orientation gets there.
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

interface Packing {
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
}

const unitVolume = (i: MixedItem) => volumeCm3(i.dims)
const STRATEGIES: Strategy[] = [
  { order: (a, b) => unitVolume(b) - unitVolume(a), rowsAlong: 'length', lightOnFragile: false },
  { order: (a, b) => unitVolume(b) - unitVolume(a), rowsAlong: 'width', lightOnFragile: false },
  { order: (a, b) => b.count - a.count, rowsAlong: 'length', lightOnFragile: false },
  { order: (a, b) => unitVolume(b) - unitVolume(a), rowsAlong: 'length', lightOnFragile: true },
]

/**
 * Packs `items` into as few boxes as possible, each the smallest of `boxes`
 * that holds its share. Returns null when some unit fits in no box.
 */
export function packMixed(items: MixedItem[], boxes: BoxType[], rules: BoxRules): MixedBox[] | null {
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

/** Most units placed, then the lowest stack. */
function bestPacking(items: MixedItem[], box: BoxType, rules: BoxRules): Packing {
  let best: Packing | null = null
  for (const strategy of STRATEGIES) {
    const packing = packOnce(items, box, rules, strategy)
    const better =
      !best ||
      packing.placed.length > best.placed.length ||
      (packing.placed.length === best.placed.length && packing.heightMm < best.heightMm)
    if (better) best = packing
    if (packing.left.every((n) => n === 0) && strategy === STRATEGIES[0]) break
  }
  return best!
}

function packOnce(items: MixedItem[], box: BoxType, rules: BoxRules, strategy: Strategy): Packing {
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

  const placed: Placed[] = []
  const left = items.map((i) => i.count)
  let points: Array<{ x: number; y: number; z: number }> = [{ x: 0, y: 0, z: 0 }]
  let weight = 0

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

  for (const index of order) {
    const item = items[index]
    const shapes = orientations(item)
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
