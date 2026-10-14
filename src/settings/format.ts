/**
 * Settings shared by everyone: the boxes in stock, the shipping modes' limits
 * and cubed-weight rules, the tuning values, and the carriers offered for
 * freight with what the customer should ideally be charged. The admin changes them in
 * the site; the values in src/data/ are the factory defaults, used until the
 * admin first saves and whenever the saved ones cannot be read.
 *
 * Shared by the page and the server; the server checks what it is sent with
 * `readSettings` before saving it.
 */

import { BOXES, BOX_PENALTY_LITERS, DEFAULT_LOSS_CM } from '../data/boxes.ts'
import { CARRIERS, CHARGE_FACTOR, type Carrier } from '../data/freight.ts'
import { FRAGILE_LOAD } from '../data/products.ts'
import { SHIPPING_MODES, type ShippingMode } from '../data/shipping.ts'
import type { BoxType } from '../engine/index.ts'

export interface Settings {
  boxes: BoxType[]
  /** Transportadora and Correios, in that order. */
  modes: ShippingMode[]
  /** Folga interna a new proposta starts with, cm. */
  lossCm: number
  /** For the "balanced" choice: litres of box one extra box is worth. */
  boxPenaltyLiters: number
  /** Times its weight a fragile unit with no layer limit carries in other products. */
  fragileLoad: number
  /** Carriers to choose from in a proposta's "Frete" section. */
  carriers: Carrier[]
  /** The ideal price to charge the customer for freight, as a multiple of the carrier's. */
  chargeFactor: number
}

export const DEFAULT_SETTINGS: Settings = {
  boxes: BOXES,
  modes: SHIPPING_MODES,
  lossCm: DEFAULT_LOSS_CM,
  boxPenaltyLiters: BOX_PENALTY_LITERS,
  fragileLoad: FRAGILE_LOAD,
  carriers: CARRIERS,
  chargeFactor: CHARGE_FACTOR,
}

/** Most boxes in stock and carriers, and the range each number may take. */
const MAX_BOXES = 20
const MAX_CARRIERS = 30
const RANGE = {
  side: [1, 300],
  emptyKg: [0, 50],
  boxMaxKg: [0.1, 1000],
  cost: [0, 100_000],
  modeMaxKg: [0.1, 1000],
  modeSide: [0, 1000],
  modeSum: [0, 3000],
  cubage: [1, 1000],
  ignoreKg: [0, 1000],
  lossCm: [0, 10],
  penalty: [0, 1000],
  fragileLoad: [0, 50],
  chargeFactor: [1, 10],
} as const

/** A box's id: its name, trimmed and in capitals. */
export const boxId = (name: string): string => name.trim().toLocaleUpperCase('pt-BR')

/** A carrier's name in the form that must be unique: no capitals or spacing differences. */
export const carrierKey = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR')

/**
 * Reads settings to be saved. Returns them, cleaned up, when every value is
 * usable; otherwise the problems, in words for the page. The shipping modes'
 * names and how their cubed weight is counted are fixed: only their numbers
 * come from what was sent. Settings saved before carriers existed get the
 * factory carriers and charge factor.
 */
export function readSettings(value: unknown): { settings: Settings } | { problems: string[] } {
  const shape = 'As configurações vieram incompletas. Recarregue a página e tente de novo.'
  if (!isObject(value) || !Array.isArray(value.boxes) || !Array.isArray(value.modes)) {
    return { problems: [shape] }
  }
  const problems: string[] = []
  const inRange = (n: unknown, [min, max]: readonly [number, number]) =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max

  // Boxes
  if (value.boxes.length === 0) problems.push('Cadastre pelo menos uma caixa.')
  if (value.boxes.length > MAX_BOXES) problems.push(`Cadastre no máximo ${MAX_BOXES} caixas.`)
  const boxes: BoxType[] = []
  value.boxes.slice(0, MAX_BOXES).forEach((b: unknown, i) => {
    const label = `Caixa ${i + 1}`
    if (!isObject(b) || !isObject(b.dims)) {
      problems.push(shape)
      return
    }
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    if (!name || name.length > 10) problems.push(`${label}: dê um nome de até 10 letras.`)
    const dims = b.dims
    if (![dims.length, dims.width, dims.height].every((d) => inRange(d, RANGE.side))) {
      problems.push(`${name || label}: as medidas devem ir de 1 a 300 cm.`)
    }
    if (!inRange(b.emptyWeightKg, RANGE.emptyKg)) {
      problems.push(`${name || label}: o peso da caixa vazia deve ir de 0 a 50 kg.`)
    }
    if (b.maxWeightKg !== undefined && !inRange(b.maxWeightKg, RANGE.boxMaxKg)) {
      problems.push(`${name || label}: o peso máximo da caixa deve ser um número maior que zero.`)
    }
    if (b.costBRL !== undefined && !inRange(b.costBRL, RANGE.cost)) {
      problems.push(`${name || label}: o custo deve ser um número, ou ficar vazio.`)
    }
    const box: BoxType = {
      id: boxId(name),
      name,
      dims: { length: dims.length as number, width: dims.width as number, height: dims.height as number },
      emptyWeightKg: b.emptyWeightKg as number,
    }
    if (b.maxWeightKg !== undefined) box.maxWeightKg = b.maxWeightKg as number
    if (b.costBRL !== undefined) box.costBRL = b.costBRL as number
    boxes.push(box)
  })
  const ids = boxes.map((b) => b.id).filter(Boolean)
  if (new Set(ids).size !== ids.length) problems.push('Duas caixas não podem ter o mesmo nome.')

  // Shipping modes: the factory ones, with the numbers sent.
  const sentModes: unknown[] = value.modes
  const modes = DEFAULT_SETTINGS.modes.map((factory) => {
    const sent = sentModes.find((m) => isObject(m) && m.id === factory.id)
    if (!isObject(sent) || !isObject(sent.cubage)) {
      problems.push(shape)
      return factory
    }
    const checks: Array<[unknown, readonly [number, number], string]> = [
      [sent.maxGrossKg, RANGE.modeMaxKg, 'o limite por caixa deve ser maior que zero'],
      [sent.maxSideCm, RANGE.modeSide, 'o maior lado deve ser um número, ou zero para não limitar'],
      [sent.maxSumCm, RANGE.modeSum, 'a soma das medidas deve ser um número, ou zero para não limitar'],
      [sent.cubage.kgPerM3, RANGE.cubage, 'o fator de cubagem deve ir de 1 a 1.000 kg/m³'],
      [sent.cubage.ignoreUpToKg, RANGE.ignoreKg, 'o peso até o qual a cubagem é ignorada deve ser um número'],
    ]
    for (const [n, range, message] of checks) {
      if (!inRange(n, range)) problems.push(`${factory.label}: ${message}.`)
    }
    return {
      ...factory,
      maxGrossKg: sent.maxGrossKg as number,
      maxSideCm: sent.maxSideCm as number,
      maxSumCm: sent.maxSumCm as number,
      cubage: {
        ...factory.cubage,
        kgPerM3: sent.cubage.kgPerM3 as number,
        ignoreUpToKg: sent.cubage.ignoreUpToKg as number,
      },
    }
  })

  if (!inRange(value.lossCm, RANGE.lossCm)) problems.push('A folga interna deve ir de 0 a 10 cm.')
  if (!inRange(value.boxPenaltyLiters, RANGE.penalty)) {
    problems.push('O valor de uma caixa a mais deve ir de 0 a 1.000 litros.')
  }
  if (!inRange(value.fragileLoad, RANGE.fragileLoad)) {
    problems.push('O peso sobre um produto frágil deve ir de 0 a 50 vezes o peso dele.')
  }

  // Carriers
  const carriers: Carrier[] = []
  const sentCarriers: unknown = value.carriers ?? DEFAULT_SETTINGS.carriers
  if (!Array.isArray(sentCarriers)) {
    problems.push(shape)
  } else {
    if (sentCarriers.length > MAX_CARRIERS) problems.push(`Cadastre no máximo ${MAX_CARRIERS} transportadoras.`)
    sentCarriers.slice(0, MAX_CARRIERS).forEach((c: unknown, i) => {
      if (!isObject(c) || typeof c.tracking !== 'boolean') {
        problems.push(shape)
        return
      }
      const name = typeof c.name === 'string' ? c.name.trim() : ''
      if (!name || name.length > 40) problems.push(`Transportadora ${i + 1}: dê um nome de até 40 letras.`)
      carriers.push({ name, tracking: c.tracking })
    })
    const names = carriers.map((c) => carrierKey(c.name)).filter(Boolean)
    if (new Set(names).size !== names.length) problems.push('Duas transportadoras não podem ter o mesmo nome.')
  }
  const chargeFactor = value.chargeFactor ?? DEFAULT_SETTINGS.chargeFactor
  if (!inRange(chargeFactor, RANGE.chargeFactor)) {
    problems.push('O valor ideal de cobrança deve ir de 1 a 10 vezes o valor da transportadora.')
  }

  if (problems.length > 0) return { problems: [...new Set(problems)] }
  return {
    settings: {
      boxes,
      modes,
      lossCm: value.lossCm as number,
      boxPenaltyLiters: value.boxPenaltyLiters as number,
      fragileLoad: value.fragileLoad as number,
      carriers,
      chargeFactor: chargeFactor as number,
    },
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
