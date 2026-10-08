import type { BoxType } from '../engine/types.ts'

/**
 * The shipping boxes in stock. Measurements in cm, weights in kg.
 *
 * To add, remove or change a box, edit this list and push. Optional fields:
 *   maxWeightKg  a weight limit for this box alone
 *   costBRL      what one box costs to send (box plus freight); when every box
 *                has it, the calculator can pick the cheapest mix
 */
export const BOXES: BoxType[] = [
  { id: 'P', name: 'P', dims: { length: 40, width: 32, height: 20 }, emptyWeightKg: 0.35 },
  { id: 'M', name: 'M', dims: { length: 37, width: 37, height: 28 }, emptyWeightKg: 0.7 },
  { id: 'G', name: 'G', dims: { length: 47, width: 36, height: 33 }, emptyWeightKg: 0.8 },
  { id: 'CM', name: 'CM', dims: { length: 50, width: 36, height: 50 }, emptyWeightKg: 1 },
]

/**
 * Space lost on each box dimension, in cm, before anything is packed.
 * TO CONFIRM: 0.5 assumes the measurements above are external. If they are
 * internal, set this to 0.
 */
export const DEFAULT_LOSS_CM = 0.5

/**
 * How much box volume, in litres, one extra box is worth when the calculator
 * balances "fewer boxes" against "less volume". With 12, a plan that uses one
 * more box is only preferred if it ships at least 12 litres less.
 * TO CALIBRATE with logistics.
 */
export const BOX_PENALTY_LITERS = 12
