/**
 * A proposta's freight: the carrier, what it quoted, what the customer is
 * charged, and the tracking code once the package is posted. It is kept apart
 * from the proposta, which never changes; each update is a new version and
 * the newest is the one in use. Shared by the page and the server, which
 * checks what it receives with `readFreight` again.
 */

import type { Carrier } from '../data/freight.ts'
import { carrierKey } from '../settings/format.ts'

export interface FreightDraft {
  carrier: string
  /** What the carrier quoted, R$. */
  quotedBRL: number
  /** What the customer is charged, R$. */
  chargedBRL: number
  /** Day of the quote, YYYY-MM-DD. */
  quoteDate: string
  /** Empty until the package is posted. */
  tracking: string
}

/** The carrier's quote, as an image or a PDF. */
export interface FreightFile {
  key: string
  name: string
  type: string
  size: number
}

/** A saved version of a proposta's freight. */
export interface Freight extends FreightDraft {
  id: number
  /** The carrier gives a tracking code, so one is pending until it is filled in. */
  trackingNeeded: boolean
  /** The charge factor in use when it was saved. */
  factor: number
  file: FreightFile | null
  /** When this version was saved, as an ISO date in UTC. */
  savedAt: string
}

/** Files accepted as the carrier's quote, and the largest. */
export const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
export const MAX_FILE_BYTES = 10_000_000

const MAX_BRL = 1_000_000
const MAX_TRACKING = 40

/** The ideal price to charge the customer, R$, to the cent. */
export const idealCharge = (quotedBRL: number, factor: number): number =>
  Math.round(quotedBRL * factor * 100) / 100

/**
 * Reads freight to be saved. The carrier must be one on offer, or `current`,
 * the proposta's carrier now, which stays accepted even if the admin has since
 * taken it off the list. Returns the freight, with names and amounts tidied,
 * or the problems in words for the page.
 */
export function readFreight(
  value: unknown,
  carriers: Carrier[],
  current?: { carrier: string; trackingNeeded: boolean } | null,
): { freight: FreightDraft & { trackingNeeded: boolean } } | { problems: string[] } {
  const shape = 'O frete veio incompleto. Recarregue a página e tente de novo.'
  if (!isObject(value)) return { problems: [shape] }
  const { carrier, quotedBRL, chargedBRL, quoteDate, tracking } = value
  if (typeof carrier !== 'string' || typeof quoteDate !== 'string' || typeof tracking !== 'string') {
    return { problems: [shape] }
  }

  const problems: string[] = []
  const key = carrierKey(carrier)
  const listed = carriers.find((c) => carrierKey(c.name) === key)
  const kept = current && carrierKey(current.carrier) === key ? current : null
  if (!key) problems.push('Escolha a transportadora.')
  else if (!listed && !kept) problems.push('Escolha uma transportadora da lista.')
  if (!isAmount(quotedBRL)) problems.push('Informe o valor informado pela transportadora.')
  if (!isAmount(chargedBRL)) problems.push('Informe o valor cobrado do cliente.')
  if (!isDay(quoteDate)) problems.push('Informe a data da cotação.')
  if (tracking.trim().length > MAX_TRACKING) {
    problems.push(`O código de rastreio pode ter até ${MAX_TRACKING} letras e números.`)
  }
  if (problems.length > 0) return { problems }

  const cents = (n: number) => Math.round(n * 100) / 100
  return {
    freight: {
      carrier: listed ? listed.name : kept!.carrier,
      quotedBRL: cents(quotedBRL as number),
      chargedBRL: cents(chargedBRL as number),
      quoteDate,
      tracking: tracking.trim(),
      trackingNeeded: listed ? listed.tracking : kept!.trackingNeeded,
    },
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isAmount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_BRL

/** A real calendar day written YYYY-MM-DD, between 2020 and 2100. */
function isDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const year = Number(v.slice(0, 4))
  if (year < 2020 || year > 2100) return false
  const date = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v
}
