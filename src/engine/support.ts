/**
 * Support: a unit must not hang over empty space. Every unit off the floor has
 * to rest on units below it with at least `MIN_SUPPORT` of its base.
 */

import type { Rect } from './layer.ts'

/** Least share of a unit's base that has to rest on something. */
export const MIN_SUPPORT = 0.75

/** Share of `top`'s area that lies over the `below` rectangles, which must not overlap each other. */
export function supportedShare(top: Rect, below: Rect[]): number {
  let covered = 0
  for (const r of below) {
    const dx = Math.min(top.x + top.w, r.x + r.w) - Math.max(top.x, r.x)
    if (dx <= 0) continue
    const dy = Math.min(top.y + top.h, r.y + r.h) - Math.max(top.y, r.y)
    if (dy > 0) covered += dx * dy
  }
  return covered / (top.w * top.h)
}

/** Whether every rectangle of `upper` is held up by `lower`. */
export function layerSupported(upper: Rect[], lower: Rect[]): boolean {
  return upper.every((r) => supportedShare(r, lower) >= MIN_SUPPORT)
}
