import { Fragment, useEffect, useMemo, useState } from 'react'

import logoUrl from './assets/logo.jpg'
import { BOXES, BOX_PENALTY_LITERS, DEFAULT_LOSS_CM } from './data/boxes.ts'
import { FRAGILE_LOAD } from './data/products.ts'
import { SHIPPING_MODES, boxAllowed, type ShippingMode } from './data/shipping.ts'
import {
  fitUnitInBox,
  fragileFactor,
  grossKg,
  planShipment,
  toMm,
  type BoxFit,
  type Priority,
  type Product,
  type Shipment,
  type Unit,
} from './engine/index.ts'
import { Arrangement } from './ui/Arrangement.tsx'
import { Field, Segmented } from './ui/controls.tsx'
import { dims, kg, list, num, parseDecimal, pct } from './ui/format.ts'
import { blankProduct, productName, Products, type ProductInput } from './ui/Products.tsx'
import { ShipmentLabel, shipmentKey } from './ui/ShipmentLabel.tsx'

const STORAGE_KEY = 'packing-calculator:settings'
const MAX_QUANTITY = 5_000_000
const MAX_SIDE_CM = 300

/** Shipping settings are remembered on this device; the products are typed in each time. */
interface Saved {
  modeId?: string
  maxWeight?: string
  protection?: string
  loss?: string
  off?: string[]
}

function loadSaved(): Saved {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return value && typeof value === 'object' ? (value as Saved) : {}
  } catch {
    return {}
  }
}

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

/** A product as typed, read into numbers, with whatever is wrong with it. */
interface Reading {
  name: string
  unit: Unit
  quantity: number
  maxLayers: number
  upright: boolean
  fragile: boolean
  dimsTyped: boolean
  /** Measurements, weight and layer limit can be calculated with. */
  ready: boolean
  quantityOk: boolean
  problems: string[]
}

function read(p: ProductInput, index: number, weightUnit: 'g' | 'kg'): Reading {
  const l = parseDecimal(p.length)
  const w = parseDecimal(p.width)
  const h = parseDecimal(p.height)
  const weightTyped = p.weight.trim() === '' ? 0 : parseDecimal(p.weight)
  const weightKg = weightUnit === 'g' ? weightTyped / 1000 : weightTyped
  const quantity = p.quantity.trim() === '' ? 0 : parseDecimal(p.quantity)
  const maxLayers = p.layerLimit.trim() === '' ? Infinity : parseDecimal(p.layerLimit)

  const sideOk = (n: number) => n > 0 && n <= MAX_SIDE_CM
  const dimsOk = sideOk(l) && sideOk(w) && sideOk(h)
  const weightOk = weightKg >= 0
  const quantityOk = Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY
  const layersOk = maxLayers === Infinity || (Number.isInteger(maxLayers) && maxLayers >= 1)

  const problems: string[] = []
  if ([p.length, p.width, p.height].some((s, i) => s.trim() !== '' && !sideOk([l, w, h][i]))) {
    problems.push(`As medidas da unidade devem ser números entre 0 e ${MAX_SIDE_CM} cm.`)
  }
  if (!weightOk) problems.push('O peso da unidade deve ser um número.')
  if (p.quantity.trim() !== '' && !quantityOk) {
    problems.push(`A quantidade deve ser um número inteiro de 1 a ${num(MAX_QUANTITY, 0)}.`)
  }
  if (!layersOk) {
    problems.push('O máximo de camadas deve ser um número inteiro a partir de 1, ou vazio para não limitar.')
  }

  return {
    name: productName(p, index),
    unit: { dims: { length: l, width: w, height: h }, weightKg },
    quantity,
    maxLayers,
    upright: p.upright,
    fragile: p.fragile,
    dimsTyped: [p.length, p.width, p.height].every((s) => s.trim() !== ''),
    ready: dimsOk && weightOk && layersOk,
    quantityOk,
    problems,
  }
}

export function App() {
  const [saved] = useState(loadSaved)

  const [products, setProducts] = useState<ProductInput[]>(() => [blankProduct(1)])
  const [weightUnit, setWeightUnit] = useState<'g' | 'kg'>('g')

  const [modeId, setModeId] = useState(() =>
    SHIPPING_MODES.some((m) => m.id === saved.modeId) ? saved.modeId! : SHIPPING_MODES[0].id,
  )
  const mode = SHIPPING_MODES.find((m) => m.id === modeId) ?? SHIPPING_MODES[0]
  const [maxWeight, setMaxWeight] = useState(() => text(saved.maxWeight, num(mode.maxGrossKg)))
  const [protection, setProtection] = useState(() => text(saved.protection, '0'))
  const [loss, setLoss] = useState(() => text(saved.loss, num(DEFAULT_LOSS_CM)))
  const [off, setOff] = useState<string[]>(() => (Array.isArray(saved.off) ? saved.off : []))

  // Fewest boxes first: fewer, fuller boxes are usually what costs least to send.
  const [priority, setPriority] = useState<Priority>(
    BOXES.every((b) => b.costBRL !== undefined) ? 'cost' : 'boxes',
  )
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    try {
      const settings: Saved = { modeId, maxWeight, protection, loss, off }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Private windows may refuse storage; the page works the same without it.
    }
  }, [modeId, maxWeight, protection, loss, off])

  const maxKg = parseDecimal(maxWeight)
  const protectionKg = parseDecimal(protection)
  const lossCm = parseDecimal(loss)
  const many = products.length > 1
  const readings = products.map((p, i) => read(p, i, weightUnit))

  const problems: string[] = []
  for (const r of readings) {
    for (const problem of r.problems) problems.push(many ? `${r.name}: ${problem}` : problem)
  }
  if (!(maxKg > 0)) problems.push('Informe o limite de peso por caixa.')
  if (!(protectionKg >= 0)) problems.push('A proteção por caixa deve ser um número, ou zero.')
  if (!(lossCm >= 0)) problems.push('A folga interna deve ser um número, ou zero.')

  const settingsOk = maxKg > 0 && protectionKg >= 0 && lossCm >= 0

  const result = useMemo(() => {
    if (!settingsOk) return null
    const readings = products.map((p, i) => read(p, i, weightUnit))
    const rules = { maxGrossKg: maxKg, protectionKg, lossCm, fragileLoad: FRAGILE_LOAD }
    const inUse = BOXES.filter((b) => !off.includes(b.id) && boxAllowed(b, mode))
    const fits = readings.map((r) =>
      r.ready
        ? inUse.map((b) =>
            fitUnitInBox(r.unit, b, { ...rules, keepUpright: r.upright, maxLayers: r.maxLayers }),
          )
        : null,
    )
    const shipments = new Map<Priority, Shipment>()
    const complete = fits.every((f) => f !== null) && readings.every((r) => r.quantityOk)
    if (complete) {
      const order: Product[] = readings.map((r) => ({
        unit: r.unit,
        quantity: r.quantity,
        keepUpright: r.upright,
        maxLayers: r.maxLayers,
        fragile: r.fragile,
      }))
      for (const p of ['cost', 'boxes', 'volume', 'balanced'] as const) {
        const shipment = planShipment(order, fits as BoxFit[][], p, rules, {
          boxPenaltyLiters: BOX_PENALTY_LITERS,
        })
        // Asking for cost without costs falls back, so keep only what was asked for.
        if (shipment && shipment.priority === p) shipments.set(p, shipment)
      }
    }
    return { fits, shipments, complete }
  }, [settingsOk, products, weightUnit, maxKg, protectionKg, lossCm, off, mode])

  const active: Priority | null = result
    ? result.shipments.has(priority)
      ? priority
      : ([...result.shipments.keys()][0] ?? null)
    : null
  const shipment = active && result ? (result.shipments.get(active) ?? null) : null

  // Other ways of choosing the boxes, when they give a different answer.
  const alternatives: Array<{ priority: Priority; shipment: Shipment }> = []
  if (shipment && result) {
    const seen = new Set([shipmentKey(shipment)])
    for (const [p, other] of result.shipments) {
      if (seen.has(shipmentKey(other))) continue
      seen.add(shipmentKey(other))
      alternatives.push({ priority: p, shipment: other })
    }
  }

  const tooBig = BOXES.filter((b) => !off.includes(b.id) && !boxAllowed(b, mode))
  const anyReady = result !== null && result.fits.some((f) => f !== null)
  const firstTable = result ? result.fits.findIndex((f) => f !== null && f.some((x) => x.capacity > 0)) : -1

  const chooseMode = (next: ShippingMode) => {
    setModeId(next.id)
    setMaxWeight(num(next.maxGrossKg))
  }
  const toggleBox = (id: string) =>
    setOff((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))

  return (
    <>
      <header className="top">
        <img className="logo" src={logoUrl} alt="Best Shipping" width={638} height={144} />
        <h1>Calculadora de embalagem</h1>
      </header>

      <main className="page">
        <Products
          products={products}
          onChange={setProducts}
          weightUnit={weightUnit}
          onWeightUnit={setWeightUnit}
        />

        {problems.length > 0 && (
          <ul className="problems" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        <form className="inputs" onSubmit={(e) => e.preventDefault()}>
          {/* Starts folded: the shipping settings are set once and rarely change. */}
          <details className="panel">
            <summary>
              Envio
              <small>
                {mode.label}, até {maxWeight || '?'} kg por caixa
              </small>
            </summary>
            <Segmented
              label="Modalidade"
              options={SHIPPING_MODES}
              value={modeId}
              onChange={(id) => chooseMode(SHIPPING_MODES.find((m) => m.id === id) ?? mode)}
            />
            <div className="row-2">
              <Field label="Limite por caixa" suffix="kg" value={maxWeight} onChange={setMaxWeight} />
              <Field label="Proteção por caixa" suffix="kg" value={protection} onChange={setProtection} />
            </div>
            <Field
              label="Folga interna"
              suffix="cm"
              value={loss}
              onChange={setLoss}
              hint="Descontada de cada medida interna da caixa, para proteção ou para o encaixe não ficar justo."
            />
            <div className="boxes">
              <span className="field-label">Caixas disponíveis</span>
              {BOXES.map((b) => (
                <label className="check" key={b.id}>
                  <input
                    type="checkbox"
                    checked={!off.includes(b.id)}
                    onChange={() => toggleBox(b.id)}
                  />
                  <span>
                    {b.name}
                    <small>{dims(b.dims)}</small>
                  </span>
                </label>
              ))}
            </div>
          </details>
        </form>

        <section className="results" aria-live="polite">
          {!anyReady && (
            <p className="empty">
              {readings.some((r) => r.dimsTyped) && problems.length > 0
                ? 'Corrija os campos indicados para ver o resultado.'
                : 'Informe as medidas da unidade para ver quantas cabem em cada caixa.'}
            </p>
          )}

          {shipment && active && (
            <ShipmentLabel
              shipment={shipment}
              priority={active}
              mode={mode}
              alternatives={alternatives}
              onPick={setPriority}
              names={readings.map((r) => r.name)}
              allowances={readings.map((r) =>
                r.fragile ? fragileFactor(r.maxLayers, FRAGILE_LOAD) : null,
              )}
              lossMm={toMm(lossCm)}
              hasWeight={readings.some((r) => r.unit.weightKg > 0)}
            />
          )}

          {result?.fits.map((fits, i) => {
            if (!fits) return null
            const r = readings[i]
            const key = products[i].id
            if (fits.every((f) => f.capacity === 0)) {
              return (
                <p className="empty" key={key}>
                  {many ? `${r.name}: ` : ''}
                  Esta unidade não cabe em nenhuma das caixas disponíveis
                  {r.upright ? ' mantendo-a em pé' : ''}. Confira as medidas, a folga interna e o
                  limite de peso.
                </p>
              )
            }
            return (
              <section className="capacity" key={key}>
                <h2>{many ? `${r.name}: quantas cabem em cada caixa` : 'Quantas cabem em cada caixa'}</h2>
                {i === firstTable && !result.complete && (
                  <p className="hint">
                    {many
                      ? 'Preencha medidas e quantidade de todos os produtos para montar o plano de caixas.'
                      : 'Informe a quantidade do pedido para montar o plano de caixas.'}
                  </p>
                )}
                {i === firstTable && off.length > 0 && (
                  <p className="hint">
                    Fora do cálculo, desmarcadas em Envio:{' '}
                    {list(BOXES.filter((b) => off.includes(b.id)).map((b) => b.name))}.
                  </p>
                )}
                {i === firstTable && tooBig.length > 0 && (
                  <p className="hint">
                    Fora do limite de tamanho para {mode.label}: {list(tooBig.map((b) => b.name))}.
                  </p>
                )}
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Caixa</th>
                      <th scope="col">Cabem</th>
                      <th scope="col">Ocupação</th>
                      <th scope="col" className="wide">
                        Peso cheia
                      </th>
                      <th scope="col">
                        <span className="sr-only">Arranjo</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fits.map((fit) => {
                      const id = `${key}:${fit.box.id}`
                      return (
                        <Fragment key={fit.box.id}>
                          <tr>
                            <th scope="row">
                              <span className="tag">{fit.box.name}</span>
                              <small>{dims(fit.box.dims)}</small>
                            </th>
                            <td>
                              {fit.capacity > 0 ? num(fit.capacity, 0) : 'Não cabe'}
                              {fit.capacity > 0 && fit.limitedBy === 'weight' && <small>limite de peso</small>}
                              {fit.capacity > 0 && fit.limitedBy === 'layers' && (
                                <small>limite de camadas</small>
                              )}
                            </td>
                            <td>{fit.capacity > 0 ? pct(fit.fill) : ''}</td>
                            <td className="wide">
                              {fit.capacity > 0 && r.unit.weightKg > 0 ? kg(grossKg(fit, fit.capacity)) : ''}
                            </td>
                            <td>
                              {fit.spaceCapacity > 0 && (
                                <button
                                  type="button"
                                  className="link"
                                  aria-expanded={open === id}
                                  onClick={() => setOpen(open === id ? null : id)}
                                >
                                  {open === id ? 'Fechar' : 'Ver arranjo'}
                                </button>
                              )}
                            </td>
                          </tr>
                          {open === id && (
                            <tr className="detail">
                              <td colSpan={5}>
                                <Arrangement fit={fit} product={many ? i : undefined} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </section>
            )
          })}

          {anyReady && (
            <p className="disclaimer">
              O cálculo é geométrico e segue as regras informadas para cada produto; não considera
              deformação da embalagem nem amassamento. Confira a primeira caixa montada antes de
              fechar o frete.
            </p>
          )}
        </section>
      </main>
    </>
  )
}
