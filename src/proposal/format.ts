/**
 * Saved propostas: what is kept, and the checks one must pass to be saved.
 * Shared by the page and the server. Anyone with the link can reach the
 * server, so it checks everything it receives with `readDraft` again.
 */

import type { Priority } from '../engine/index.ts'

/** Raised when the layout of what is saved changes, so older propostas can still be read. */
export const FORMAT = 1

/** One product as typed on the page. */
export interface ProposalProduct {
  name: string
  length: string
  width: string
  height: string
  weight: string
  quantity: string
  layerLimit: string
  upright: boolean
  fragile: boolean
}

/** Everything typed, as typed, so loading a proposta fills the page exactly as it was. */
export interface ProposalInput {
  weightUnit: 'g' | 'kg'
  products: ProposalProduct[]
  shipping: {
    modeId: string
    maxWeight: string
    protection: string
    loss: string
    /** Boxes left out of the calculation. */
    off: string[]
  }
  priority: Priority
}

/** What the calculator proposed when the proposta was saved. */
export interface ProposalResult {
  priority: Priority
  /** Shipping mode, as the page names it. */
  mode: string
  headline: string
  totalBoxes: number
  volumeM3: number
  grossKg: number
  cubedKg: number
  chargeableKg: number
  lines: ProposalLine[]
}

export interface ProposalLine {
  box: string
  boxes: number
  contents: Array<{ product: string; units: number }>
  grossKgPerBox: number
  mixed: boolean
}

/** A proposta ready to be saved. */
export interface ProposalDraft {
  number: string
  responsible: string
  input: ProposalInput
  result: ProposalResult
}

export interface Proposal extends ProposalDraft {
  id: number
  /** When it was saved, as an ISO date in UTC. */
  savedAt: string
}

/** One row of the list of saved propostas. */
export interface ProposalSummary {
  id: number
  number: string
  responsible: string
  /** Product names, separated by commas. */
  products: string
  headline: string
  savedAt: string
}

/** Longest text accepted in each field, and most products per proposta. */
export const LIMITS = { number: 40, responsible: 80, name: 80, value: 20, products: 50, lines: 500 }

const PRIORITIES: readonly Priority[] = ['cost', 'boxes', 'volume', 'balanced']

/** The form of a proposta number that must be unique: no capitals or spacing differences. */
export const numberKey = (number: string): string =>
  number.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR')

/**
 * Reads a proposta to be saved. Returns it when everything required is there;
 * otherwise the problems, in words for the page.
 */
export function readDraft(value: unknown): { draft: ProposalDraft } | { problems: string[] } {
  const shape = 'O pedido para salvar a proposta veio incompleto. Recarregue a página e tente de novo.'
  if (!isObject(value) || !isObject(value.input) || !isObject(value.result)) return { problems: [shape] }
  const { number, responsible, input, result } = value
  if (!isText(number, LIMITS.number) || !isText(responsible, LIMITS.responsible)) {
    return { problems: [shape] }
  }
  if (!isInput(input) || !isResult(result)) return { problems: [shape] }

  const problems: string[] = []
  if (!number.trim()) problems.push('Informe o número da proposta.')
  if (!responsible.trim()) problems.push('Informe o responsável pela proposta.')
  if (input.products.some((p) => !p.name.trim())) problems.push('Dê um nome a cada produto.')
  if (result.lines.length === 0) problems.push('Complete os produtos para que o plano de caixas apareça.')
  if (problems.length > 0) return { problems }
  return { draft: { number, responsible, input, result } }
}

function isInput(v: Record<string, unknown>): v is Record<string, unknown> & ProposalInput {
  const shipping = v.shipping
  return (
    (v.weightUnit === 'g' || v.weightUnit === 'kg') &&
    PRIORITIES.includes(v.priority as Priority) &&
    Array.isArray(v.products) &&
    v.products.length >= 1 &&
    v.products.length <= LIMITS.products &&
    v.products.every(isProduct) &&
    isObject(shipping) &&
    isText(shipping.modeId, LIMITS.value) &&
    isText(shipping.maxWeight, LIMITS.value) &&
    isText(shipping.protection, LIMITS.value) &&
    isText(shipping.loss, LIMITS.value) &&
    Array.isArray(shipping.off) &&
    shipping.off.length <= LIMITS.products &&
    shipping.off.every((id) => isText(id, LIMITS.value))
  )
}

function isProduct(p: unknown): p is ProposalProduct {
  return (
    isObject(p) &&
    isText(p.name, LIMITS.name) &&
    (['length', 'width', 'height', 'weight', 'quantity', 'layerLimit'] as const).every((k) =>
      isText(p[k], LIMITS.value),
    ) &&
    typeof p.upright === 'boolean' &&
    typeof p.fragile === 'boolean'
  )
}

function isResult(v: Record<string, unknown>): v is Record<string, unknown> & ProposalResult {
  return (
    PRIORITIES.includes(v.priority as Priority) &&
    isText(v.mode, LIMITS.value * 2) &&
    isText(v.headline, LIMITS.name * 4) &&
    (['totalBoxes', 'volumeM3', 'grossKg', 'cubedKg', 'chargeableKg'] as const).every((k) =>
      isAmount(v[k]),
    ) &&
    Array.isArray(v.lines) &&
    v.lines.length <= LIMITS.lines &&
    v.lines.every(
      (l) =>
        isObject(l) &&
        isText(l.box, LIMITS.value) &&
        isAmount(l.boxes) &&
        isAmount(l.grossKgPerBox) &&
        typeof l.mixed === 'boolean' &&
        Array.isArray(l.contents) &&
        l.contents.length <= LIMITS.products &&
        l.contents.every((c) => isObject(c) && isText(c.product, LIMITS.name) && isAmount(c.units)),
    )
  )
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
