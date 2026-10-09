import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BOXES } from '../data/boxes.ts'
import { SHIPPING_MODES, boxAllowed } from '../data/shipping.ts'
import { fitUnitInBox, toMm, type BoxFit } from './fit.ts'
import { freightWeight } from './freight.ts'
import { packLayer, type Rect } from './layer.ts'
import { packMixed, type BoxRules, type MixedBox, type MixedItem } from './mixed.ts'
import { placeUnits, type PlacedUnit } from './place.ts'
import { planOrder } from './plan.ts'
import { planShipment, type Product } from './shipment.ts'
import { MIN_SUPPORT, supportedShare } from './support.ts'
import type { Axis, BoxType, PackingRules, Unit } from './types.ts'

const RULES: PackingRules = { maxGrossKg: 25, protectionKg: 0, lossCm: 0, keepUpright: false }

const box = (name: string, l: number, w: number, h: number, emptyWeightKg = 0): BoxType => ({
  id: name,
  name,
  dims: { length: l, width: w, height: h },
  emptyWeightKg,
})

const unit = (l: number, w: number, h: number, weightKg = 0): Unit => ({
  dims: { length: l, width: w, height: h },
  weightKg,
})

/** Small repeatable random number generator, so failures can be reproduced. */
function random(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function assertLayerValid(rects: Rect[], L: number, W: number, a: number, b: number) {
  for (const r of rects) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= L && r.y + r.h <= W, 'unit inside the layer')
    assert.ok((r.w === a && r.h === b) || (r.w === b && r.h === a), 'unit keeps its size')
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const p = rects[i]
      const q = rects[j]
      const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y
      assert.ok(apart, 'units do not overlap')
    }
  }
}

/** Checks that the layers described by a fit really are inside the box. */
function assertFitValid(fit: BoxFit, rules: PackingRules) {
  const usable = (axis: Axis) => toMm(fit.box.dims[axis] - rules.lossCm)
  assert.equal(fit.plane.uMm, usable(fit.plane.u))
  assert.equal(fit.plane.vMm, usable(fit.plane.v))
  const sides = [fit.unit.dims.length, fit.unit.dims.width, fit.unit.dims.height]
    .map(toMm)
    .sort((p, q) => p - q)

  let depth = 0
  let units = 0
  for (const layer of fit.layerTypes) {
    const [a, b] = layer.footprintCm.map(toMm)
    const t = toMm(layer.thicknessCm)
    assert.deepEqual([a, b, t].sort((p, q) => p - q), sides, 'layer uses the unit sides')
    assert.equal(layer.rects.length, layer.unitsPerLayer)
    assertLayerValid(layer.rects, fit.plane.uMm, fit.plane.vMm, a, b)
    depth += layer.layers * t
    units += layer.layers * layer.unitsPerLayer
  }
  assert.ok(depth <= usable(fit.stackAxis), 'layers fit along the stacking direction')
  assert.equal(units, fit.spaceCapacity)
}

/** Checks that units placed in 3D are inside the box, keep their size and do not overlap. */
function assertPlacedValid(fit: BoxFit, placed: PlacedUnit[], rules: PackingRules) {
  const axes: Axis[] = ['length', 'width', 'height']
  const sides = axes.map((a) => toMm(fit.unit.dims[a])).sort((p, q) => p - q)
  // Where each layer starts along the stacking direction.
  const starts: number[] = []
  let depth = 0
  for (const type of fit.layerTypes) {
    for (let i = 0; i < type.layers; i++) {
      starts.push(depth)
      depth += toMm(type.thicknessCm)
    }
  }

  for (const p of placed) {
    for (const a of axes) {
      const room = toMm(fit.box.dims[a] - rules.lossCm)
      assert.ok(p.at[a] >= 0 && p.at[a] + p.size[a] <= room, 'unit inside the box')
    }
    assert.deepEqual(axes.map((a) => p.size[a]).sort((x, y) => x - y), sides, 'unit keeps its size')
    assert.equal(p.at[fit.stackAxis], starts[p.layer], 'unit sits in its layer')
  }
  for (let i = 1; i < placed.length; i++) {
    assert.ok(placed[i].layer >= placed[i - 1].layer, 'layers come in order')
  }

  // Sweep along the length so only units that share some of it are compared.
  const sorted = [...placed].sort((p, q) => p.at.length - q.at.length)
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]
    for (let j = i + 1; j < sorted.length && sorted[j].at.length < p.at.length + p.size.length; j++) {
      const q = sorted[j]
      const apart = axes.some((a) => p.at[a] + p.size[a] <= q.at[a] || q.at[a] + q.size[a] <= p.at[a])
      assert.ok(apart, 'units do not overlap')
    }
  }

  // Every unit off the floor rests on the tops of units below it.
  const base = (p: PlacedUnit): Rect => ({ x: p.at.length, y: p.at.width, w: p.size.length, h: p.size.width })
  const tops = new Map<number, Rect[]>()
  for (const p of placed) {
    const top = p.at.height + p.size.height
    tops.set(top, [...(tops.get(top) ?? []), base(p)])
  }
  for (const p of placed) {
    if (p.at.height === 0) continue
    const share = supportedShare(base(p), tops.get(p.at.height) ?? [])
    assert.ok(share >= MIN_SUPPORT, `unit rests on units below (${Math.round(share * 100)}%)`)
  }
}

/** Checks a box of mixed products against every rule the packer has to keep. */
function assertMixedValid(m: MixedBox, items: MixedItem[], rules: BoxRules) {
  const axes: Axis[] = ['length', 'width', 'height']
  const byProduct = new Map(items.map((i) => [i.product, i]))
  const placed = m.placed
  for (const p of placed) {
    const item = byProduct.get(p.product)!
    for (const a of axes) {
      const room = toMm(m.box.dims[a] - rules.lossCm)
      assert.ok(p.at[a] >= 0 && p.at[a] + p.size[a] <= room, 'unit inside the box')
    }
    const sides = axes.map((a) => toMm(item.dims[a])).sort((x, y) => x - y)
    assert.deepEqual(axes.map((a) => p.size[a]).sort((x, y) => x - y), sides, 'unit keeps its size')
    if (item.keepUpright) assert.equal(p.size.height, toMm(item.dims.height), 'upright unit stays upright')
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const p = placed[i]
      const q = placed[j]
      const apart = axes.some((a) => p.at[a] + p.size[a] <= q.at[a] || q.at[a] + q.size[a] <= p.at[a])
      assert.ok(apart, 'units do not overlap')
    }
  }

  // What each unit rests on, then how many units are stacked above each one.
  const base = (p: PlacedUnit): Rect => ({ x: p.at.length, y: p.at.width, w: p.size.length, h: p.size.width })
  const restsOn = placed.map((p) =>
    p.at.height === 0
      ? []
      : placed.filter(
          (q) => q.at.height + q.size.height === p.at.height && supportedShare(base(p), [base(q)]) > 0,
        ),
  )
  placed.forEach((p, i) => {
    if (p.at.height === 0) return
    const share = supportedShare(base(p), restsOn[i].map(base))
    assert.ok(share >= MIN_SUPPORT, `unit rests on units below (${Math.round(share * 100)}%)`)
  })

  // Weight passes down in proportion to contact. A fragile unit carries in
  // other products at most its own weight times one less than its layer
  // limit, or fragileLoad times without one, and nothing of another product
  // whose weight is unknown.
  const carried = new Map<PlacedUnit, Map<number, number>>()
  for (const p of [...placed].sort((a, b) => b.at.height - a.at.height)) {
    const passing = new Map(carried.get(p) ?? [])
    passing.set(p.product, (passing.get(p.product) ?? 0) + byProduct.get(p.product)!.weightKg)
    const contacts = restsOn[placed.indexOf(p)].map((q) => ({ q, area: supportedShare(base(p), [base(q)]) }))
    const total = contacts.reduce((sum, c) => sum + c.area, 0)
    for (const { q, area } of contacts) {
      const theirs = carried.get(q) ?? new Map<number, number>()
      for (const [product, kg] of passing) theirs.set(product, (theirs.get(product) ?? 0) + (kg * area) / total)
      carried.set(q, theirs)
    }
  }
  for (const p of placed) {
    const item = byProduct.get(p.product)!
    if (!item.fragile) continue
    let others = 0
    for (const [product, kg] of carried.get(p) ?? []) {
      if (product === p.product) continue
      assert.ok(byProduct.get(product)!.weightKg > 0, 'nothing of unknown weight on a fragile unit')
      others += kg
    }
    const factor = Number.isFinite(item.maxLayers) ? item.maxLayers - 1 : rules.fragileLoad
    assert.ok(others <= factor * item.weightKg + 1e-9, 'fragile unit not overloaded')
  }
  const above = new Map<PlacedUnit, number>()
  for (const p of [...placed].sort((a, b) => b.at.height - a.at.height)) {
    const mine = above.get(p) ?? 0
    for (const q of restsOn[placed.indexOf(p)]) above.set(q, Math.max(above.get(q) ?? 0, mine + 1))
  }
  for (const p of placed) {
    const limit = byProduct.get(p.product)!.maxLayers
    assert.ok((above.get(p) ?? 0) <= limit - 1, 'layer limit kept')
  }

  const weight = placed.reduce((sum, p) => sum + byProduct.get(p.product)!.weightKg, 0)
  const tare = m.box.emptyWeightKg + rules.protectionKg
  assert.ok(Math.abs(m.grossKg - (tare + weight)) < 1e-9, 'gross weight adds up')
  assert.ok(m.grossKg <= Math.min(rules.maxGrossKg, m.box.maxWeightKg ?? Infinity) + 1e-9, 'within weight limit')
  for (const c of m.contents) {
    assert.equal(placed.filter((p) => p.product === c.product).length, c.units, 'contents match')
  }
}

/** The most a plain grid holds: every unit facing the same way. */
function plainGrid(u: Unit, b: BoxType, lossCm: number): number {
  const d = [u.dims.length, u.dims.width, u.dims.height].map(toMm)
  const s = [b.dims.length, b.dims.width, b.dims.height].map((x) => toMm(x - lossCm))
  const turns = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]
  return Math.max(
    ...turns.map(
      (t) => Math.floor(s[0] / d[t[0]]) * Math.floor(s[1] / d[t[1]]) * Math.floor(s[2] / d[t[2]]),
    ),
  )
}

describe('packing one layer', () => {
  it('fills an exact grid', () => {
    assert.equal(packLayer(600, 400, 100, 100).count, 24)
  })

  it('turns some units to fit one more', () => {
    // Either orientation alone gives 2; one turned unit beside two others gives 3.
    const layout = packLayer(500, 400, 300, 200)
    assert.equal(layout.count, 3)
    assertLayerValid(layout.rects, 500, 400, 300, 200)
  })

  it('returns nothing when the unit is too big', () => {
    assert.equal(packLayer(100, 100, 200, 50).count, 0)
  })

  it('always gives a valid layout, never worse than a plain grid', () => {
    const rnd = random(7)
    for (let n = 0; n < 400; n++) {
      const L = 100 + Math.floor(rnd() * 500)
      const W = 100 + Math.floor(rnd() * 400)
      const a = 30 + Math.floor(rnd() * 150)
      const b = 30 + Math.floor(rnd() * 150)
      const layout = packLayer(L, W, a, b)
      assert.equal(layout.rects.length, layout.count)
      assertLayerValid(layout.rects, L, W, a, b)
      const grid = Math.max(
        Math.floor(L / a) * Math.floor(W / b),
        Math.floor(L / b) * Math.floor(W / a),
      )
      assert.ok(layout.count >= grid, `${L}x${W} with ${a}x${b}`)
      assert.ok(layout.count <= Math.floor((L * W) / (a * b)))
    }
  })

  it('copes with very small units in a very large layer', () => {
    const layout = packLayer(3000, 3000, 7, 11)
    assert.equal(layout.rects.length, layout.count)
    assert.ok(layout.count >= Math.floor(3000 / 7) * Math.floor(3000 / 11))
    assert.ok(layout.count <= Math.floor((3000 * 3000) / (7 * 11)))
  })
})

describe('units per box', () => {
  it('counts a simple grid', () => {
    const fit = fitUnitInBox(unit(10, 10, 10), box('A', 40, 30, 20), RULES)
    assert.equal(fit.capacity, 24)
    assert.equal(fit.stackAxis, 'height')
    assert.equal(fit.limitedBy, 'space')
    assert.equal(fit.fill, 1)
    assertFitValid(fit, RULES)
  })

  it('stands units on another face when that holds more', () => {
    // Lying flat: 2 layers of 12 = 24. On their side: 2 layers of 16 = 32.
    const fit = fitUnitInBox(unit(10, 10, 7), box('A', 40, 30, 20), RULES)
    assert.equal(fit.capacity, 32)
    assertFitValid(fit, RULES)
  })

  it('keeps units upright when asked', () => {
    const rules = { ...RULES, keepUpright: true }
    const fit = fitUnitInBox(unit(10, 10, 7), box('A', 40, 30, 20), rules)
    assert.equal(fit.capacity, 24)
    assert.equal(fit.stackAxis, 'height')
    assert.deepEqual(fit.layerTypes.map((t) => t.thicknessCm), [7])
    assertFitValid(fit, rules)
  })

  it('takes the loss off every box dimension', () => {
    const rules = { ...RULES, lossCm: 0.5 }
    const fit = fitUnitInBox(unit(10, 10, 10), box('A', 40, 30, 20), rules)
    assert.equal(fit.capacity, 3 * 2 * 1)
    assertFitValid(fit, rules)
  })

  it('stops at the weight limit, counting the box and the padding', () => {
    const b = box('A', 40, 30, 20, 0.5)
    const u = unit(10, 10, 10, 1)
    const light = fitUnitInBox(u, b, { ...RULES, maxGrossKg: 10 })
    assert.equal(light.spaceCapacity, 24)
    assert.equal(light.weightCapacity, 9)
    assert.equal(light.capacity, 9)
    assert.equal(light.limitedBy, 'weight')

    const padded = fitUnitInBox(u, b, { ...RULES, maxGrossKg: 10, protectionKg: 0.6 })
    assert.equal(padded.capacity, 8)
  })

  it("uses the box's own limit when it is lower", () => {
    const b = { ...box('A', 40, 30, 20), maxWeightKg: 5 }
    assert.equal(fitUnitInBox(unit(10, 10, 10, 1), b, RULES).capacity, 5)
  })

  it('reports zero when the unit does not fit', () => {
    const fit = fitUnitInBox(unit(50, 50, 50), box('A', 40, 30, 20), RULES)
    assert.equal(fit.capacity, 0)
    assert.deepEqual(fit.layerTypes, [])
  })

  it('is valid and at least as good as a plain grid in the real boxes', () => {
    const rnd = random(11)
    const rules = { ...RULES, lossCm: 0.5 }
    for (let n = 0; n < 150; n++) {
      const u = unit(
        3 + Math.floor(rnd() * 250) / 10,
        3 + Math.floor(rnd() * 200) / 10,
        2 + Math.floor(rnd() * 150) / 10,
      )
      for (const b of BOXES) {
        const fit = fitUnitInBox(u, b, rules)
        assertFitValid(fit, rules)
        const label = `${u.dims.length}x${u.dims.width}x${u.dims.height} in ${b.name}`
        assert.ok(fit.spaceCapacity >= plainGrid(u, b, rules.lossCm), label)
        assert.ok(fit.fill <= 1, label)
      }
    }
  })

  it('stays within a layer limit, turning units to make the most of it', () => {
    const b = box('A', 40, 30, 20)
    const u = unit(10, 10, 5)
    // Lying on a 10 × 5 side, two layers of 24 already fill the box.
    const two = fitUnitInBox(u, b, { ...RULES, maxLayers: 2 })
    assert.equal(two.capacity, 48)
    assert.equal(two.limitedBy, 'space')
    const one = fitUnitInBox(u, b, { ...RULES, maxLayers: 1 })
    assert.equal(one.capacity, 24)
    assert.equal(one.limitedBy, 'layers')
    // Upright, each layer is 5 cm tall, so two layers hold half the box.
    const upright = fitUnitInBox(u, b, { ...RULES, keepUpright: true, maxLayers: 2 })
    assert.equal(upright.capacity, 24)
    assert.equal(upright.limitedBy, 'layers')
    for (const fit of [two, one, upright]) assertFitValid(fit, RULES)
  })

  it('never stacks more units than the layer limit', () => {
    const rnd = random(31)
    const rules = { ...RULES, lossCm: 0.5 }
    for (let n = 0; n < 80; n++) {
      const u = unit(
        3 + Math.floor(rnd() * 250) / 10,
        3 + Math.floor(rnd() * 200) / 10,
        2 + Math.floor(rnd() * 150) / 10,
      )
      const maxLayers = 1 + Math.floor(rnd() * 5)
      for (const b of BOXES) {
        const unlimited = fitUnitInBox(u, b, rules)
        const fit = fitUnitInBox(u, b, { ...rules, maxLayers })
        const label = `${u.dims.length}x${u.dims.width}x${u.dims.height} in ${b.name}, ${maxLayers} layers`
        assertFitValid(fit, rules)
        if (fit.capacity > 0) assert.equal(fit.stackAxis, 'height', label)
        const layers = fit.layerTypes.reduce((sum, t) => sum + t.layers, 0)
        assert.ok(layers <= maxLayers, label)
        assert.ok(fit.spaceCapacity <= unlimited.spaceCapacity, label)
        assert.equal(fit.limitedBy === 'layers', fit.spaceCapacity < unlimited.spaceCapacity, label)
      }
    }
  })
})

describe('placing units in 3D', () => {
  it('places every unit of the real boxes validly', () => {
    const rnd = random(23)
    const rules = { ...RULES, lossCm: 0.5 }
    for (let n = 0; n < 60; n++) {
      const u = unit(
        3 + Math.floor(rnd() * 250) / 10,
        3 + Math.floor(rnd() * 200) / 10,
        2 + Math.floor(rnd() * 150) / 10,
      )
      for (const b of BOXES) {
        const fit = fitUnitInBox(u, b, rules)
        const placed = placeUnits(fit, fit.spaceCapacity)
        assert.equal(placed.length, fit.spaceCapacity)
        assertPlacedValid(fit, placed, rules)
      }
    }
  })

  it('rests every unit on the floor or on units below, upright or with a layer limit', () => {
    const rnd = random(41)
    const rules = { ...RULES, lossCm: 0.5 }
    for (let n = 0; n < 60; n++) {
      const u = unit(
        3 + Math.floor(rnd() * 250) / 10,
        3 + Math.floor(rnd() * 200) / 10,
        2 + Math.floor(rnd() * 150) / 10,
      )
      for (const extra of [{ keepUpright: true }, { maxLayers: 1 + Math.floor(rnd() * 4) }]) {
        for (const b of BOXES) {
          const fit = fitUnitInBox(u, b, { ...rules, ...extra })
          assertPlacedValid(fit, placeUnits(fit, fit.spaceCapacity), rules)
        }
      }
    }
  })

  it('keeps the height vertical when units must stand upright', () => {
    const rules = { ...RULES, keepUpright: true }
    const fit = fitUnitInBox(unit(12, 9, 7), box('A', 40, 30, 20), rules)
    const placed = placeUnits(fit)
    assert.ok(placed.length > 0)
    assert.ok(placed.every((p) => p.size.height === 70))
    assertPlacedValid(fit, placed, rules)
  })

  it('fills the layers in order up to the weight limit', () => {
    // 12 cubes per layer, two layers by space; 14 by weight.
    const fit = fitUnitInBox(unit(10, 10, 10, 1), box('A', 40, 30, 20, 0.5), {
      ...RULES,
      maxGrossKg: 15,
    })
    assert.equal(fit.capacity, 14)
    const placed = placeUnits(fit)
    assert.deepEqual(
      [0, 1].map((layer) => placed.filter((p) => p.layer === layer).length),
      [12, 2],
    )
    assertPlacedValid(fit, placed, RULES)
  })

  it('places nothing when the unit does not fit', () => {
    assert.deepEqual(placeUnits(fitUnitInBox(unit(50, 50, 50), box('A', 40, 30, 20), RULES)), [])
  })
})

describe('mixing products in a box', () => {
  const ROOM: BoxRules = { lossCm: 0, maxGrossKg: 25, protectionKg: 0, fragileLoad: 3 }
  const item = (
    product: number,
    l: number,
    w: number,
    h: number,
    count: number,
    extra: Partial<MixedItem> = {},
  ): MixedItem => ({
    product,
    dims: { length: l, width: w, height: h },
    weightKg: 0,
    keepUpright: false,
    maxLayers: Infinity,
    fragile: false,
    count,
    ...extra,
  })
  const product = (u: Unit, quantity: number, extra: Partial<Product> = {}): Product => ({
    unit: u,
    quantity,
    keepUpright: false,
    maxLayers: Infinity,
    fragile: false,
    ...extra,
  })
  const fitsFor = (products: Product[]) =>
    products.map((p) =>
      BOXES.map((b) =>
        fitUnitInBox(p.unit, b, { ...RULES, keepUpright: p.keepUpright, maxLayers: p.maxLayers }),
      ),
    )

  const heights = (m: MixedBox, product: number) =>
    m.placed.filter((p) => p.product === product).map((p) => p.at.height)

  it('puts a fragile product on top of a heavier one', () => {
    // 800 g cubes are too heavy for 200 g fragile units, so the cubes go first
    // and fill the floor; the fragile units can only go above them.
    const items = [
      item(0, 10, 10, 5, 12, { fragile: true, weightKg: 0.2 }),
      item(1, 10, 10, 10, 24, { weightKg: 0.8 }),
    ]
    const boxes = packMixed(items, [box('A', 40, 30, 30)], ROOM)!
    assert.equal(boxes.length, 1)
    assertMixedValid(boxes[0], items, ROOM)
    assert.ok(Math.min(...heights(boxes[0], 0)) >= 200)
  })

  it('puts fragile products above light ones when there is room', () => {
    const items = [
      item(0, 10, 10, 10, 12, { fragile: true, weightKg: 0.25 }),
      item(1, 10, 10, 2, 12, { weightKg: 0.05 }),
    ]
    const boxes = packMixed(items, [box('A', 40, 30, 20)], ROOM)!
    assert.equal(boxes.length, 1)
    assertMixedValid(boxes[0], items, ROOM)
    assert.ok(heights(boxes[0], 0).every((z) => z >= 20))
  })

  it('lets light products ride on fragile ones when that is what fits', () => {
    // The four cups need the whole floor and cannot stand on the one bag, so
    // the bag goes on top of them.
    const items = [
      item(0, 20, 15, 10, 4, { fragile: true, weightKg: 0.3 }),
      item(1, 10, 10, 2, 1, { weightKg: 0.05 }),
    ]
    const boxes = packMixed(items, [box('A', 40, 30, 12)], ROOM)!
    assert.equal(boxes.length, 1)
    assertMixedValid(boxes[0], items, ROOM)
    assert.ok(heights(boxes[0], 0).every((z) => z === 0))
    assert.ok(heights(boxes[0], 1).every((z) => z === 100))
  })

  it('lets a fragile product carry less when it has a layer limit', () => {
    // The four cups need the whole floor, so the 500 g bag can only go on top.
    // Without a limit a 300 g cup carries three times its weight, so it fits;
    // stacked at most two high, a cup carries only its own weight, so it does not.
    const items = (maxLayers: number) => [
      item(0, 20, 15, 10, 4, { fragile: true, weightKg: 0.3, maxLayers }),
      item(1, 10, 10, 2, 1, { weightKg: 0.5 }),
    ]
    const free = packMixed(items(Infinity), [box('A', 40, 30, 12)], ROOM)!
    assert.equal(free.length, 1)
    assertMixedValid(free[0], items(Infinity), ROOM)
    const limited = packMixed(items(2), [box('A', 40, 30, 12)], ROOM)!
    assert.equal(limited.length, 2)
    for (const m of limited) assertMixedValid(m, items(2), ROOM)
  })

  it('keeps products too heavy for a fragile one underneath it', () => {
    // 900 g mugs are more than three times a 250 g cup: they go on the floor
    // and the cups may stand on them, never the other way round.
    const items = [
      item(0, 10, 10, 10, 12, { fragile: true, weightKg: 0.25 }),
      item(1, 10, 10, 5, 4, { weightKg: 0.9 }),
    ]
    const boxes = packMixed(items, [box('A', 40, 30, 20)], ROOM)!
    assert.equal(boxes.length, 1)
    assertMixedValid(boxes[0], items, ROOM)
    assert.ok(heights(boxes[0], 1).every((z) => z === 0))
  })

  it('puts nothing on a fragile product of unknown weight', () => {
    // With no weight to judge by, the bags go underneath the cups.
    const items = [
      item(0, 10, 10, 10, 12, { fragile: true }),
      item(1, 10, 10, 2, 24, { weightKg: 0.05 }),
    ]
    const boxes = packMixed(items, [box('A', 40, 30, 20)], ROOM)!
    assert.equal(boxes.length, 1)
    assertMixedValid(boxes[0], items, ROOM)
    assert.ok(heights(boxes[0], 0).every((z) => z >= 40))
  })

  it('keeps every rule with random products in the real boxes', () => {
    const rnd = random(53)
    const rules: BoxRules = { lossCm: 0.5, maxGrossKg: 25, protectionKg: 0.2, fragileLoad: 3 }
    for (let n = 0; n < 25; n++) {
      const items: MixedItem[] = []
      const kinds = 2 + Math.floor(rnd() * 2)
      for (let p = 0; p < kinds; p++) {
        items.push(
          item(
            p,
            3 + Math.floor(rnd() * 200) / 10,
            3 + Math.floor(rnd() * 150) / 10,
            2 + Math.floor(rnd() * 120) / 10,
            1 + Math.floor(rnd() * 25),
            {
              weightKg: Math.floor(rnd() * 800) / 1000,
              keepUpright: rnd() < 0.3,
              maxLayers: rnd() < 0.3 ? 1 + Math.floor(rnd() * 3) : Infinity,
              fragile: rnd() < 0.3,
            },
          ),
        )
      }
      const boxes = packMixed(items, BOXES, rules)
      assert.ok(boxes, 'every unit finds a box')
      for (const m of boxes) assertMixedValid(m, items, rules)
      for (const kind of items) {
        const total: number = boxes.reduce(
          (sum, m) => sum + (m.contents.find((c) => c.product === kind.product)?.units ?? 0),
          0,
        )
        assert.equal(total, kind.count, 'every unit is packed once')
      }
    }
  })

  it('mixes leftovers when that saves a box', () => {
    // Alone, 30 cubes take a G and 10 half cubes a P; together they fit one G.
    const products = [
      product(unit(10, 10, 10), 30),
      product(unit(10, 10, 5), 10, { fragile: true }),
    ]
    const shipment = planShipment(products, fitsFor(products), 'boxes', ROOM)!
    assert.equal(shipment.totalBoxes, 1)
    assert.equal(shipment.lines[0].box.id, 'G')
    assert.deepEqual(shipment.lines[0].contents, [
      { product: 0, units: 30 },
      { product: 1, units: 10 },
    ])
    const items = products.map((p, i) => ({ ...item(i, 0, 0, 0, 0), ...p, dims: p.unit.dims, weightKg: 0, count: p.quantity }))
    assertMixedValid(
      { box: shipment.lines[0].box, placed: shipment.lines[0].placed!, contents: shipment.lines[0].contents, grossKg: shipment.lines[0].grossKgPerBox },
      items,
      ROOM,
    )
  })

  it('ships every unit of every product exactly once', () => {
    const rnd = random(61)
    for (let n = 0; n < 20; n++) {
      const products = [0, 1, 2].map(() =>
        product(
          unit(4 + Math.floor(rnd() * 150) / 10, 4 + Math.floor(rnd() * 120) / 10, 3 + Math.floor(rnd() * 100) / 10, 0.2),
          1 + Math.floor(rnd() * 120),
          { fragile: rnd() < 0.4, maxLayers: rnd() < 0.3 ? 2 : Infinity },
        ),
      )
      for (const priority of ['boxes', 'volume', 'balanced'] as const) {
        const shipment = planShipment(products, fitsFor(products), priority, ROOM, { boxPenaltyLiters: 12 })!
        products.forEach((p, i) => {
          const shipped = shipment.lines.reduce(
            (sum, l) => sum + l.boxes * (l.contents.find((c) => c.product === i)?.units ?? 0),
            0,
          )
          assert.equal(shipped, p.quantity)
        })
        assert.equal(shipment.totalBoxes, shipment.lines.reduce((sum, l) => sum + l.boxes, 0))
      }
    }
  })

  it('plans a single product as before', () => {
    const p = product(unit(10.5, 8, 5, 0.25), 500)
    const fits = fitsFor([p])
    for (const priority of ['boxes', 'volume', 'balanced'] as const) {
      const plan = planOrder(fits[0], 500, priority, { boxPenaltyLiters: 12 })!
      const shipment = planShipment([p], fits, priority, ROOM, { boxPenaltyLiters: 12 })!
      assert.deepEqual(
        shipment.lines.map((l) => `${l.boxes}x${l.box.id}:${l.contents[0].units}`),
        plan.lines.map((l) => `${l.boxes}x${l.box.id}:${l.unitsPerBox}`),
      )
      assert.equal(shipment.spareUnits, plan.spareUnits)
    }
  })
})

describe('choosing boxes for an order', () => {
  // With 10 cm cubes: S holds 25, M holds 50, L holds 100.
  const S = box('S', 50, 50, 10, 0.2)
  const M = box('M', 50, 50, 20, 0.4)
  const L = box('L', 100, 50, 20, 0.8)
  const cube = unit(10, 10, 10, 0.1)
  const fits = [S, M, L].map((b) => fitUnitInBox(cube, b, RULES))
  const names = (plan: ReturnType<typeof planOrder>) =>
    plan!.lines.map((l) => `${l.boxes}x${l.fit.box.name}:${l.unitsPerBox}`)

  it('has the capacities the example assumes', () => {
    assert.deepEqual(fits.map((f) => f.capacity), [25, 50, 100])
  })

  it('prefers a medium and a small over one large for 70 units', () => {
    const plan = planOrder(fits, 70, 'volume')!
    assert.deepEqual(names(plan), ['1xM:50', '1xS:20'])
    assert.equal(plan.totalBoxes, 2)
    assert.equal(plan.spareUnits, 5)
    assert.equal(plan.lines[1].partial, true)
    assert.ok(Math.abs(plan.volumeM3 - 0.075) < 1e-9)
    // 70 units of 0.1 kg plus the two empty boxes.
    assert.ok(Math.abs(plan.grossKg - (7 + 0.4 + 0.2)) < 1e-9)
  })

  it('uses one large box for 70 units when fewest boxes comes first', () => {
    const plan = planOrder(fits, 70, 'boxes')!
    assert.deepEqual(names(plan), ['1xL:70'])
    assert.equal(plan.spareUnits, 30)
  })

  it('breaks a volume tie with fewer boxes', () => {
    assert.deepEqual(names(planOrder(fits, 100, 'volume')), ['1xL:100'])
  })

  it('fills full boxes and leaves one partial', () => {
    const plan = planOrder(fits, 260, 'volume')!
    assert.equal(plan.lines.reduce((n, l) => n + l.boxes * l.unitsPerBox, 0), 260)
    assert.ok(plan.lines.filter((l) => l.partial).length <= 1)
  })

  it('returns nothing without a quantity or a box that fits', () => {
    assert.equal(planOrder(fits, 0), null)
    assert.equal(planOrder([fitUnitInBox(unit(200, 200, 200), S, RULES)], 10), null)
  })

  it('picks the cheapest mix when every box has a cost', () => {
    // By volume the answer is M + S; at these prices one L is cheaper (50 against 62).
    const priced = [
      { ...S, costBRL: 30 },
      { ...M, costBRL: 32 },
      { ...L, costBRL: 50 },
    ].map((b) => fitUnitInBox(cube, b, RULES))
    const plan = planOrder(priced, 70, 'cost')!
    assert.deepEqual(names(plan), ['1xL:70'])
    assert.equal(plan.costBRL, 50)
    assert.equal(plan.priority, 'cost')
    // Without costs the same request falls back to the balanced choice.
    assert.equal(planOrder(fits, 70, 'cost')!.priority, 'balanced')
  })

  it('balances boxes against volume by default', () => {
    // One L ships 100 litres; M + S ships 75. At 12 litres a box the saving wins.
    assert.deepEqual(names(planOrder(fits, 70, 'balanced', { boxPenaltyLiters: 12 })), [
      '1xM:50',
      '1xS:20',
    ])
    // If a box is worth 30 litres, the single large box wins.
    assert.deepEqual(names(planOrder(fits, 70, 'balanced', { boxPenaltyLiters: 30 })), ['1xL:70'])
  })

  it('keeps the balanced plan between the two extremes', () => {
    const rnd = random(5)
    const rules = { ...RULES, lossCm: 0.5 }
    for (let n = 0; n < 120; n++) {
      const u = unit(
        3 + Math.floor(rnd() * 200) / 10,
        3 + Math.floor(rnd() * 150) / 10,
        2 + Math.floor(rnd() * 120) / 10,
        0.05 + rnd() * 0.5,
      )
      const real = BOXES.map((b) => fitUnitInBox(u, b, rules))
      const quantity = 1 + Math.floor(rnd() * 3000)
      const balanced = planOrder(real, quantity, 'balanced', { boxPenaltyLiters: 12 })
      const fewest = planOrder(real, quantity, 'boxes')
      const tightest = planOrder(real, quantity, 'volume')
      if (!balanced || !fewest || !tightest) continue
      assert.ok(fewest.totalBoxes <= balanced.totalBoxes, `boxes, case ${n}`)
      assert.ok(balanced.totalBoxes <= tightest.totalBoxes, `boxes, case ${n}`)
      assert.ok(tightest.volumeM3 <= balanced.volumeM3 + 1e-9, `volume, case ${n}`)
      assert.ok(balanced.volumeM3 <= fewest.volumeM3 + 1e-9, `volume, case ${n}`)
      for (const plan of [balanced, fewest, tightest]) {
        assert.equal(plan.lines.reduce((s, l) => s + l.boxes * l.unitsPerBox, 0), quantity)
        for (const l of plan.lines) {
          assert.ok(l.grossKgPerBox <= rules.maxGrossKg + 1e-9, 'box within the weight limit')
          assert.ok(l.unitsPerBox >= 1)
        }
      }
    }
  })

  it('matches an exhaustive search on small orders', () => {
    const rnd = random(3)
    for (let n = 0; n < 200; n++) {
      // Three made-up boxes with unrelated capacities and volumes.
      const made = [0, 1, 2].map((i) => {
        const side = 10 + Math.floor(rnd() * 40)
        const f = fitUnitInBox(cube, box(`B${i}`, side, 10, 10), RULES)
        return { ...f, capacity: 1 + Math.floor(rnd() * 12) }
      })
      const quantity = 1 + Math.floor(rnd() * 40)
      const volume = (f: BoxFit) => f.box.dims.length * 100
      let bestVolume = Infinity
      let bestBoxes = Infinity
      const max = made.map((f) => Math.ceil(quantity / f.capacity))
      for (let a = 0; a <= max[0]; a++) {
        for (let b = 0; b <= max[1]; b++) {
          for (let c = 0; c <= max[2]; c++) {
            const held = a * made[0].capacity + b * made[1].capacity + c * made[2].capacity
            if (held < quantity) continue
            const v = a * volume(made[0]) + b * volume(made[1]) + c * volume(made[2])
            const k = a + b + c
            if (v < bestVolume || (v === bestVolume && k < bestBoxes)) {
              bestVolume = v
              bestBoxes = k
            }
          }
        }
      }
      const plan = planOrder(made, quantity, 'volume')!
      assert.ok(Math.abs(plan.volumeM3 * 1e6 - bestVolume) < 1e-6, `case ${n}`)
      assert.equal(plan.totalBoxes, bestBoxes, `case ${n}`)
      assert.equal(plan.lines.reduce((s, l) => s + l.boxes * l.unitsPerBox, 0), quantity)
    }
  })

  it('handles a very large order quickly', () => {
    const started = Date.now()
    const plan = planOrder(fits, 5_000_000, 'volume')!
    assert.equal(plan.lines.reduce((n, l) => n + l.boxes * l.unitsPerBox, 0), 5_000_000)
    assert.equal(plan.totalBoxes, 50_000)
    assert.ok(Date.now() - started < 5000)
  })
})

describe('cubed weight', () => {
  const cube = unit(10, 10, 10, 0.01)
  // 50 × 40 × 30 cm = 0.06 m³: 18 kg at 300 kg/m³, 10 kg at C×L×A/6000.
  const fits = [fitUnitInBox(cube, box('A', 50, 40, 30, 1), RULES)]
  const plan = planOrder(fits, 120)!

  it('compares totals for a carrier shipment', () => {
    const w = freightWeight(plan, { kgPerM3: 300, scope: 'shipment', ignoreUpToKg: 0 })
    assert.equal(plan.totalBoxes, 2)
    assert.ok(Math.abs(w.cubedKg - 36) < 1e-9)
    assert.ok(Math.abs(w.chargeableKg - 36) < 1e-9)
  })

  it('compares each parcel on its own and ignores small cubed weights', () => {
    const perKg = 1_000_000 / 6000
    const counted = freightWeight(plan, { kgPerM3: perKg, scope: 'box', ignoreUpToKg: 5 })
    assert.ok(Math.abs(counted.chargeableKg - 20) < 1e-9)
    const ignored = freightWeight(plan, { kgPerM3: perKg, scope: 'box', ignoreUpToKg: 10 })
    assert.ok(Math.abs(ignored.chargeableKg - plan.grossKg) < 1e-9)
  })
})

describe('box and shipping data', () => {
  it('has well-formed boxes', () => {
    assert.equal(new Set(BOXES.map((b) => b.id)).size, BOXES.length)
    for (const b of BOXES) {
      assert.ok(b.dims.length > 0 && b.dims.width > 0 && b.dims.height > 0, b.name)
      assert.ok(b.emptyWeightKg >= 0, b.name)
    }
  })

  it('has every box within the size limits of every shipping mode', () => {
    for (const mode of SHIPPING_MODES) {
      for (const b of BOXES) assert.ok(boxAllowed(b, mode), `${b.name} via ${mode.label}`)
    }
  })
})
