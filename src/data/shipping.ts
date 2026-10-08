import type { CubageRule } from '../engine/freight.ts'
import type { BoxType } from '../engine/types.ts'

export interface ShippingMode {
  id: string
  label: string
  /** Heaviest a packed box may be, kg. */
  maxGrossKg: number
  /** Longest side allowed, cm. 0 means no limit. */
  maxSideCm: number
  /** Largest length + width + height allowed, cm. 0 means no limit. */
  maxSumCm: number
  cubage: CubageRule
}

/**
 * Transportadora allows 25 kg per box (confirmed by Francesco, 2026-10-08,
 * after briefly trying 30 kg).
 *
 * TO CONFIRM with logistics and the contracts in use:
 *   - Transportadora: the 300 kg/m³ factor is the usual one for road freight;
 *     parcel carriers often use 167 instead.
 *   - Correios: 30 kg, 100 cm per side and 200 cm for the three sides added
 *     are the published PAC/SEDEX limits. Cubed weight is C × L × A / 6000,
 *     charged per parcel. Sources disagree on whether it is ignored up to
 *     5 kg or up to 10 kg; 5 is used here because it never underestimates.
 */
export const SHIPPING_MODES: ShippingMode[] = [
  {
    id: 'transportadora',
    label: 'Transportadora',
    maxGrossKg: 25,
    maxSideCm: 0,
    maxSumCm: 0,
    cubage: { kgPerM3: 300, scope: 'shipment', ignoreUpToKg: 0 },
  },
  {
    id: 'correios',
    label: 'Correios',
    maxGrossKg: 30,
    maxSideCm: 100,
    maxSumCm: 200,
    cubage: { kgPerM3: 1_000_000 / 6000, scope: 'box', ignoreUpToKg: 5 },
  },
]

/** Whether a box is within the size limits of a shipping mode. */
export function boxAllowed(box: BoxType, mode: ShippingMode): boolean {
  const { length, width, height } = box.dims
  if (mode.maxSideCm > 0 && Math.max(length, width, height) > mode.maxSideCm) return false
  if (mode.maxSumCm > 0 && length + width + height > mode.maxSumCm) return false
  return true
}
