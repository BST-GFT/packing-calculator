/**
 * Where every unit sits in a packed box, for drawing it in 3D.
 *
 * The layers of a fit are stacked from the start of the stacking direction in
 * the order they are listed, so the drawing matches the layer-by-layer text.
 */

import { toMm, type BoxFit } from './fit.ts'
import type { Axis } from './types.ts'

export type Point = Record<Axis, number>

export interface PlacedUnit {
  /** Corner nearest the box's origin, in mm from the corner of the usable space. */
  at: Point
  /** Size along each box dimension, mm. */
  size: Point
  /** Layer number, from 0 at the start of the stack. */
  layer: number
  /** Lies the other way round from the first unit of its layer. */
  turned: boolean
  /** Index of the unit's product in the order. */
  product: number
}

/**
 * The first `count` units of a box, layer by layer. By default that is the
 * number that goes in a full box, so under a weight limit the last layer
 * drawn may be partial.
 */
export function placeUnits(fit: BoxFit, count = fit.capacity, product = 0): PlacedUnit[] {
  const { stackAxis, plane } = fit
  const point = (along: number, u: number, v: number): Point => {
    const p: Point = { length: 0, width: 0, height: 0 }
    p[stackAxis] = along
    p[plane.u] = u
    p[plane.v] = v
    return p
  }

  const placed: PlacedUnit[] = []
  let depth = 0
  let layer = 0
  for (const type of fit.layerTypes) {
    const thickness = toMm(type.thicknessCm)
    const reference = type.rects[0]?.w
    for (let i = 0; i < type.layers; i++) {
      for (const r of type.rects) {
        if (placed.length >= count) return placed
        placed.push({
          at: point(depth, r.x, r.y),
          size: point(thickness, r.w, r.h),
          layer,
          turned: r.w !== reference,
          product,
        })
      }
      depth += thickness
      layer++
    }
  }
  return placed
}
