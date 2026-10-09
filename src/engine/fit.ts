/**
 * How many units fit in one box.
 *
 * Units are packed in flat layers. Within a layer every unit stands on the same
 * face, so the layer has one thickness; different layers may use different
 * faces. Layers are stacked along the box's height, or along its length or
 * width when that holds more, unless the units must stay upright or there is
 * a limit on layers.
 */

import { packLayer, type Rect } from './layer.ts'
import type { Axis, BoxType, Dims, PackingRules, Unit } from './types.ts'

export interface LayerType {
  /** Unit dimension that runs along the stacking direction, cm. */
  thicknessCm: number
  /** The two unit dimensions lying flat in the layer, cm. */
  footprintCm: [number, number]
  unitsPerLayer: number
  /** How many layers of this kind go in the box. */
  layers: number
  /** Position of each unit in the layer, in mm from one corner. */
  rects: Rect[]
}

export interface BoxFit {
  box: BoxType
  unit: Unit
  /** Units that fit by space alone. */
  spaceCapacity: number
  /** Units allowed by the weight limit; Infinity when the unit weight is unknown. */
  weightCapacity: number
  /** Units to put in a full box: the smaller of the two above. */
  capacity: number
  /** What keeps the box from holding more; 'layers' when the layer limit cost units. */
  limitedBy: 'space' | 'weight' | 'layers'
  /** Weight limit that applied to this box. */
  maxGrossKg: number
  /** Layer limit that applied; Infinity when there is none. */
  maxLayers: number
  /** Empty box plus padding. */
  tareKg: number
  /** Direction the layers are stacked in. */
  stackAxis: Axis
  /** The two box dimensions each layer spans, with their usable sizes in mm. */
  plane: { u: Axis; v: Axis; uMm: number; vMm: number }
  layerTypes: LayerType[]
  /** Share of the box's volume taken by `capacity` units, from 0 to 1. */
  fill: number
}

const PLANE: Record<Axis, [Axis, Axis]> = {
  height: ['length', 'width'],
  length: ['width', 'height'],
  width: ['length', 'height'],
}

export const toMm = (cm: number): number => Math.round(cm * 10)

export const volumeCm3 = (d: Dims): number => d.length * d.width * d.height

/** Weight of one packed box holding `units` units. */
export const grossKg = (fit: BoxFit, units: number): number =>
  fit.tareKg + units * fit.unit.weightKg

export function fitUnitInBox(unit: Unit, box: BoxType, rules: PackingRules): BoxFit {
  const usable: Record<Axis, number> = {
    length: toMm(box.dims.length - rules.lossCm),
    width: toMm(box.dims.width - rules.lossCm),
    height: toMm(box.dims.height - rules.lossCm),
  }
  const u = [toMm(unit.dims.length), toMm(unit.dims.width), toMm(unit.dims.height)]

  const maxLayers = rules.maxLayers ?? Infinity
  const best = bestStack(usable, u, rules.keepUpright, maxLayers)
  // What the box would hold without the layer limit, to tell whether it cost units.
  const unlimited = Number.isFinite(maxLayers)
    ? bestStack(usable, u, rules.keepUpright, Infinity).spaceCapacity
    : best.spaceCapacity

  const maxGrossKg = Math.min(rules.maxGrossKg, box.maxWeightKg ?? Infinity)
  const tareKg = box.emptyWeightKg + rules.protectionKg
  const weightCapacity =
    unit.weightKg > 0
      ? Math.max(0, Math.floor((maxGrossKg - tareKg) / unit.weightKg + 1e-9))
      : Infinity
  const capacity = Math.min(best.spaceCapacity, weightCapacity)
  const boxVolume = volumeCm3(box.dims)

  return {
    box,
    unit,
    ...best,
    weightCapacity,
    capacity,
    limitedBy:
      weightCapacity < best.spaceCapacity
        ? 'weight'
        : best.spaceCapacity < unlimited
          ? 'layers'
          : 'space',
    maxGrossKg,
    maxLayers,
    tareKg,
    fill: boxVolume > 0 ? (capacity * volumeCm3(unit.dims)) / boxVolume : 0,
  }
}

type Stack = Pick<BoxFit, 'spaceCapacity' | 'stackAxis' | 'plane' | 'layerTypes'>

/**
 * The stacking direction and layers that hold the most units in a box with
 * `usable` mm of room. Units kept upright, or a layer limit, allow only flat
 * layers up the box height. Every flat layer is one unit tall, so then the
 * number of layers is how many units sit on top of each other.
 */
function bestStack(
  usable: Record<Axis, number>,
  u: number[],
  keepUpright: boolean,
  maxLayers: number,
): Stack {
  const flatOnly = keepUpright || Number.isFinite(maxLayers)
  const stackAxes: Axis[] = flatOnly ? ['height'] : ['height', 'length', 'width']
  // Standing upright, the unit's own height is the layer thickness.
  const faces = keepUpright ? [2] : [0, 1, 2]

  let best: Stack = {
    spaceCapacity: 0,
    stackAxis: 'height',
    plane: { u: 'length', v: 'width', uMm: usable.length, vMm: usable.width },
    layerTypes: [],
  }
  for (const axis of stackAxes) {
    const [pu, pv] = PLANE[axis]
    const stacked = stackLayers(usable[axis], usable[pu], usable[pv], u, faces, maxLayers)
    const total = stacked.reduce((sum, t) => sum + t.unitsPerLayer * t.layers, 0)
    // Strictly more: on a tie the earlier axis wins, and height comes first.
    if (total > best.spaceCapacity) {
      best = {
        spaceCapacity: total,
        stackAxis: axis,
        plane: { u: pu, v: pv, uMm: usable[pu], vMm: usable[pv] },
        layerTypes: stacked,
      }
    }
  }
  return best
}

/**
 * Best stack of at most `maxLayers` layers in a space `stack` mm deep over a
 * `pu` × `pv` mm base. `faces` lists which unit dimensions (0, 1, 2) may run
 * along the stack. Tries every mix of the layer thicknesses that allows.
 */
function stackLayers(
  stack: number,
  pu: number,
  pv: number,
  u: number[],
  faces: number[],
  maxLayers: number,
): LayerType[] {
  interface Option {
    thickness: number
    footprint: [number, number]
    count: number
    rects: Rect[]
  }
  const options: Option[] = []
  for (const k of faces) {
    const thickness = u[k]
    if (thickness <= 0 || thickness > stack) continue
    // Two faces with the same thickness give the same layer.
    if (options.some((o) => o.thickness === thickness)) continue
    const footprint: [number, number] = [u[(k + 1) % 3], u[(k + 2) % 3]]
    const layout = packLayer(pu, pv, footprint[0], footprint[1])
    if (layout.count > 0) {
      options.push({ thickness, footprint, count: layout.count, rects: layout.rects })
    }
  }
  if (options.length === 0) return []

  // Prefer more units, then fewer kinds of layer, then less depth used.
  let bestUnits = -1
  let bestKinds = 0
  let bestUsed = 0
  let bestCounts: number[] = []
  const counts = new Array<number>(options.length).fill(0)

  const consider = (units: number, used: number) => {
    const kinds = counts.filter((c) => c > 0).length
    const better =
      units > bestUnits ||
      (units === bestUnits && (kinds < bestKinds || (kinds === bestKinds && used < bestUsed)))
    if (better) {
      bestUnits = units
      bestKinds = kinds
      bestUsed = used
      bestCounts = counts.slice()
    }
  }

  const search = (i: number, rest: number, layersLeft: number, units: number) => {
    const o = options[i]
    const max = Math.min(Math.floor(rest / o.thickness), layersLeft)
    if (i === options.length - 1) {
      counts[i] = max
      consider(units + max * o.count, stack - rest + max * o.thickness)
      return
    }
    for (let c = max; c >= 0; c--) {
      counts[i] = c
      search(i + 1, rest - c * o.thickness, layersLeft - c, units + c * o.count)
    }
  }
  search(0, stack, maxLayers, 0)

  return options
    .map((o, i) => ({
      thicknessCm: o.thickness / 10,
      footprintCm: [o.footprint[0] / 10, o.footprint[1] / 10] as [number, number],
      unitsPerLayer: o.count,
      layers: bestCounts[i],
      rects: o.rects,
    }))
    .filter((t) => t.layers > 0)
    .sort((p, q) => q.unitsPerLayer - p.unitsPerLayer)
}
