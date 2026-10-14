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

/** A saved moment in local time: "13/10/2026, 15:42". */
export const when = (iso: string): string =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))

/** "1 caixa", "3 caixas" */
export const count = (n: number, one: string, many: string): string =>
  `${num(n, 0)} ${n === 1 ? one : many}`

/** Reads what someone typed, accepting either a comma or a point. NaN when it is not a number. */
export function parseDecimal(text: string): number {
  const cleaned = text.trim().replace(',', '.')
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return NaN
  return Number(cleaned)
}

/**
 * Reads an amount of money as people type it: "1.234,50", "1234,5", "R$ 80".
 * A point is read as a thousands separator when three digits follow it, as in
 * "1.234"; otherwise as the decimal point. NaN when it is not an amount.
 */
export function parseMoney(text: string): number {
  let cleaned = text.replace(/R\$|\s/g, '')
  if (cleaned.includes(',')) cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) cleaned = cleaned.replace(/\./g, '')
  return parseDecimal(cleaned)
}

/** An amount for a money field: "1234,50". */
export const moneyText = (n: number): string => n.toFixed(2).replace('.', ',')

/** A day written YYYY-MM-DD, the Brazilian way: "14/10/2026". */
export const day = (iso: string): string => iso.split('-').reverse().join('/')

/** Today in local time, YYYY-MM-DD. */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A file size: "230 KB", "1,4 MB". */
export const fileSize = (bytes: number): string =>
  bytes < 1_000_000 ? `${num(Math.max(1, Math.round(bytes / 1000)), 0)} KB` : `${num(bytes / 1_000_000, 1)} MB`

/** "A, B e C" */
export function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
}

/** How many colours tell products apart; the CSS defines --p1 to --p6. */
export const PRODUCT_COLORS = 6

/** The colour that marks product `index` in the list and in the 3D view. */
export const productColor = (index: number): string => `var(--p${(index % PRODUCT_COLORS) + 1})`

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
