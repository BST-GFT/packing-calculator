/** A carrier offered in the proposta's "Frete" section. */
export interface Carrier {
  name: string
  /** Its shipments get a tracking code, asked for once the package is posted. */
  tracking: boolean
}

/**
 * Factory list of carriers; the admin keeps the real list in the admin area.
 * Sedex needs a tracking code (sales, 2026-10-14).
 */
export const CARRIERS: Carrier[] = [{ name: 'Sedex', tracking: true }]

/**
 * What the customer should ideally be charged for freight: the carrier's
 * price times this (sales, 2026-10-14). The admin can change it.
 */
export const CHARGE_FACTOR = 1.4
