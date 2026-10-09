/**
 * Packing one flat layer: how many a × b rectangles fit in an L × W rectangle,
 * and where each one goes. Every measurement here is a whole number of
 * millimetres.
 *
 * The method removes one full strip at a time: a column of units along the
 * left edge or a row along the bottom edge, in either orientation, and then
 * solves what is left the same way. Results are memoised, so every combination
 * of strips is tried. This finds the layouts a person would build by hand
 * (blocks of units side by side, some turned 90°), but not interlocked
 * "pinwheel" layouts, so the count can occasionally be one short of the true
 * maximum.
 *
 * A layer standing on end has gravity along its width (y): every unit has to
 * rest on the floor or on units below. In that mode, whatever goes above a row
 * stays within the row's length, and the strip left beside the row is packed
 * from the floor on its own, so every unit is fully supported.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface LayerLayout {
  count: number
  rects: Rect[]
}

const EMPTY: LayerLayout = { count: 0, rects: [] }

/** Above this many sub-problems the strip search is replaced by a cheaper one. */
const MAX_STATES = 250_000

const KEY = 100_000

export function packLayer(
  L: number,
  W: number,
  a: number,
  b: number,
  gravity = false,
): LayerLayout {
  if (!(a > 0 && b > 0 && L > 0 && W > 0)) return EMPTY
  const min = Math.min(a, b)
  if (L < min || W < min) return EMPTY
  if (reachable(L, a, b) * reachable(W, a, b) > MAX_STATES) {
    return packTwoBlocks(L, W, a, b, gravity)
  }
  return packStrips(L, W, a, b, gravity)
}

/** Upper bound on how many distinct leftover lengths the strip search can reach. */
function reachable(X: number, a: number, b: number): number {
  return Math.min(X + 1, (Math.floor(X / a) + 1) * (Math.floor(X / b) + 1))
}

function packStrips(L: number, W: number, a: number, b: number, gravity: boolean): LayerLayout {
  const min = Math.min(a, b)
  // [unit width, unit height] for each way the unit can be turned.
  const turns: Array<[number, number]> = a === b ? [[a, b]] : [[a, b], [b, a]]
  // memo value = count * 8 + move, where move 0 means "nothing fits".
  const memo = new Map<number, number>()
  const units = (l: number, w: number) => Math.floor(solve(l, w) / 8)

  const solve = (l: number, w: number): number => {
    if (l < min || w < min) return 0
    const key = l * KEY + w
    const known = memo.get(key)
    if (known !== undefined) return known

    let count = 0
    let move = 0
    for (let t = 0; t < turns.length; t++) {
      const [uw, uh] = turns[t]
      if (uw > l || uh > w) continue
      const column = Math.floor(w / uh) + units(l - uw, w)
      if (column > count) {
        count = column
        move = 1 + 2 * t
      }
      const n = Math.floor(l / uw)
      const row = gravity
        ? n + units(n * uw, w - uh) + units(l - n * uw, w)
        : n + units(l, w - uh)
      if (row > count) {
        count = row
        move = 2 + 2 * t
      }
    }
    const value = count * 8 + move
    memo.set(key, value)
    return value
  }

  // Units are listed so that, with gravity, each comes after what holds it up.
  const rects: Rect[] = []
  const build = (x: number, y: number, l: number, w: number) => {
    const move = solve(l, w) % 8
    if (move === 0) return
    const [uw, uh] = turns[(move - 1) >> 1]
    if (move % 2 === 1) {
      const n = Math.floor(w / uh)
      for (let i = 0; i < n; i++) rects.push({ x, y: y + i * uh, w: uw, h: uh })
      build(x + uw, y, l - uw, w)
    } else {
      const n = Math.floor(l / uw)
      for (let i = 0; i < n; i++) rects.push({ x: x + i * uw, y, w: uw, h: uh })
      if (gravity) {
        build(x, y + uh, n * uw, w - uh)
        build(x + n * uw, y, l - n * uw, w)
      } else {
        build(x, y + uh, l, w - uh)
      }
    }
  }
  build(0, 0, L, W)
  return { count: units(L, W), rects }
}

/**
 * Cheaper search for very small units in a very large layer: one block of
 * units in each orientation, split either along the length or the width.
 * With gravity, a block on top may not be wider than the block below it.
 */
function packTwoBlocks(L: number, W: number, a: number, b: number, gravity: boolean): LayerLayout {
  let best = 0
  let split: { along: 'L' | 'W'; n: number } = { along: 'L', n: 0 }

  for (let i = 0; i <= Math.floor(L / a); i++) {
    const count = i * Math.floor(W / b) + Math.floor((L - i * a) / b) * Math.floor(W / a)
    if (count > best) {
      best = count
      split = { along: 'L', n: i }
    }
  }
  const overhangs = Math.floor(L / b) * b > Math.floor(L / a) * a
  for (let j = 0; j <= Math.floor(W / b); j++) {
    if (gravity && j > 0 && overhangs) break
    const count = j * Math.floor(L / a) + Math.floor((W - j * b) / a) * Math.floor(L / b)
    if (count > best) {
      best = count
      split = { along: 'W', n: j }
    }
  }

  const rects: Rect[] = []
  const grid = (x0: number, y0: number, cols: number, rows: number, uw: number, uh: number) => {
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) rects.push({ x: x0 + c * uw, y: y0 + r * uh, w: uw, h: uh })
    }
  }
  if (split.along === 'L') {
    const used = split.n * a
    grid(0, 0, split.n, Math.floor(W / b), a, b)
    grid(used, 0, Math.floor((L - used) / b), Math.floor(W / a), b, a)
  } else {
    const used = split.n * b
    grid(0, 0, Math.floor(L / a), split.n, a, b)
    grid(0, used, Math.floor(L / b), Math.floor((W - used) / a), b, a)
  }
  return { count: best, rects }
}
