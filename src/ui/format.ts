import type { Axis, Dims } from '../engine/index.ts'

/** A number the Brazilian way: 1.234,5 */
export const num = (n: number, digits = 1): string =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(n)

export const kg = (n: number): string => `${num(n, n < 10 ? 2 : 1)} kg`

export const m3 = (n: number): string =>
  `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n)} m³`

export const pct = (ratio: number): string => `${Math.round(ratio * 100)}%`

export const brl = (n: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)

export const dims = (d: Dims): string =>
  `${num(d.length)} × ${num(d.width)} × ${num(d.height)} cm`

/** "1 caixa", "3 caixas" */
export const count = (n: number, one: string, many: string): string =>
  `${num(n, 0)} ${n === 1 ? one : many}`

/** Reads what someone typed, accepting either a comma or a point. NaN when it is not a number. */
export function parseDecimal(text: string): number {
  const cleaned = text.trim().replace(',', '.')
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return NaN
  return Number(cleaned)
}

/** "A, B e C" */
export function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
}

export const AXIS: Record<Axis, string> = {
  length: 'comprimento',
  width: 'largura',
  height: 'altura',
}

export const ALONG: Record<Axis, string> = {
  length: 'ao longo do comprimento da caixa',
  width: 'ao longo da largura da caixa',
  height: 'na vertical',
}
