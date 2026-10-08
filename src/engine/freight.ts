/**
 * Cubed weight (peso cubado): the weight a carrier charges for when a
 * shipment is bulky for what it weighs.
 */

import { volumeCm3 } from './fit.ts'
import type { Plan } from './plan.ts'

export interface CubageRule {
  /** Kilograms charged per cubic metre of box. */
  kgPerM3: number
  /**
   * 'shipment' compares the totals of the whole shipment; 'box' compares each
   * box on its own, as when every box is posted as a separate parcel.
   */
  scope: 'box' | 'shipment'
  /** A cubed weight up to this value is ignored and the real weight is charged. */
  ignoreUpToKg: number
}

export interface FreightWeight {
  cubedKg: number
  /** The weight the carrier charges for. */
  chargeableKg: number
}

export function freightWeight(plan: Plan, rule: CubageRule): FreightWeight {
  const counted = (cubed: number) => (cubed > rule.ignoreUpToKg ? cubed : 0)

  let cubedKg = 0
  let perBox = 0
  for (const line of plan.lines) {
    const cubed = (volumeCm3(line.fit.box.dims) / 1e6) * rule.kgPerM3
    cubedKg += line.boxes * cubed
    perBox += line.boxes * Math.max(line.grossKgPerBox, counted(cubed))
  }
  const chargeableKg =
    rule.scope === 'box' ? perBox : Math.max(plan.grossKg, counted(cubedKg))
  return { cubedKg, chargeableKg }
}
