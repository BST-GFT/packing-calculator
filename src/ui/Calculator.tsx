import { Fragment, useMemo, useState } from 'react'

import { boxAllowed, type ShippingMode } from '../data/shipping.ts'
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
} from '../engine/index.ts'
import { saveProposal } from '../proposal/api.ts'
import { readDraft, type Proposal, type ProposalInput, type ProposalResult } from '../proposal/format.ts'
import type { Freight } from '../proposal/freight.ts'
import { sameBoxes, summarize } from '../proposal/summary.ts'
import { useSettings } from '../settings/context.tsx'
import { Arrangement } from './Arrangement.tsx'
import { Field, Segmented } from './controls.tsx'
import { checkFreight, FreightPanel, freightForm, sendFreight } from './Freight.tsx'
import { dims, kg, list, num, parseDecimal, pct, when } from './format.ts'
import { blankProduct, productName, Products, type ProductInput } from './Products.tsx'
import { ShipmentLabel, shipmentKey } from './ShipmentLabel.tsx'

const STORAGE_KEY = 'packing-calculator:settings'
const MAX_QUANTITY = 5_000_000
const MAX_SIDE_CM = 300

/**
 * Shipping choices this device was last set to, used for each new proposta.
 * Only what someone changed is kept, and loading a proposta does not change
 * them. The weight limit and the folga are not kept: each new proposta starts
 * from the shared settings, so the admin's changes reach every device.
 * (Older versions kept them too; those values are now ignored.)
 */
interface Saved {
  modeId?: string
  protection?: string
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

function remember(change: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSaved(), ...change }))
  } catch {
    // Private windows may refuse storage; the page works the same without it.
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

/** The proposta as last saved or loaded, to tell whether the page still matches it. */
interface Snapshot {
  id: number
  number: string
  responsible: string
  savedAt: string
  /** When the admin last corrected its number or responsible, if ever. */
  correctedAt: string | null
  /** The input as JSON, for comparing. */
  input: string
  result: ProposalResult
  loaded: boolean
}

type Saving = { state: 'idle' } | { state: 'saving' } | { state: 'refused'; problems: string[] }

/** The calculator, empty for a new proposta or filled in from a saved one. */
export function Calculator({ loaded }: { loaded: Proposal | null }) {
  const { settings, status: settingsStatus } = useSettings()
  const { boxes, modes } = settings
  const [saved] = useState(loadSaved)
  const start = loaded?.input

  const [number, setNumber] = useState(loaded?.number ?? '')
  const [responsible, setResponsible] = useState(loaded?.responsible ?? '')
  const [products, setProducts] = useState<ProductInput[]>(() =>
    start ? start.products.map((p, i) => ({ id: i + 1, ...p })) : [blankProduct(1)],
  )
  const [weightUnit, setWeightUnit] = useState<'g' | 'kg'>(start?.weightUnit ?? 'g')

  const [modeId, setModeId] = useState(() => {
    const id = start ? start.shipping.modeId : saved.modeId
    return modes.some((m) => m.id === id) ? id! : modes[0].id
  })
  const mode = modes.find((m) => m.id === modeId) ?? modes[0]
  const [maxWeight, setMaxWeight] = useState(() =>
    start ? start.shipping.maxWeight : num(mode.maxGrossKg),
  )
  const [protection, setProtection] = useState(() =>
    start ? start.shipping.protection : text(saved.protection, '0'),
  )
  const [loss, setLoss] = useState(() =>
    start ? start.shipping.loss : num(settings.lossCm),
  )
  const [off, setOff] = useState<string[]>(() =>
    start ? start.shipping.off : Array.isArray(saved.off) ? saved.off : [],
  )

  // Least volume first (Francesco, 2026-10-14); the other choices are offered under the plan.
  const [priority, setPriority] = useState<Priority>(
    start?.priority ?? (boxes.every((b) => b.costBRL !== undefined) ? 'cost' : 'volume'),
  )
  const [open, setOpen] = useState<string | null>(null)

  const [record, setRecord] = useState<Snapshot | null>(() =>
    loaded
      ? {
          id: loaded.id,
          number: loaded.number,
          responsible: loaded.responsible,
          savedAt: loaded.savedAt,
          correctedAt: loaded.correctedAt ?? null,
          input: JSON.stringify(loaded.input),
          result: loaded.result,
          loaded: true,
        }
      : null,
  )
  const [saving, setSaving] = useState<Saving>({ state: 'idle' })

  // Freight as typed, and the saved proposta's versions of it, newest first.
  const [freight, setFreight] = useState(() => freightForm(loaded?.freight ?? null))
  const [freightHistory, setFreightHistory] = useState<Freight[]>(loaded?.freightHistory ?? [])
  const savedFreight = (f: Freight, earlier: Freight[]) => {
    setFreightHistory([f, ...earlier])
    setFreight(freightForm(f))
  }

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
    const rules = { maxGrossKg: maxKg, protectionKg, lossCm, fragileLoad: settings.fragileLoad }
    const inUse = boxes.filter((b) => !off.includes(b.id) && boxAllowed(b, mode))
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
          boxPenaltyLiters: settings.boxPenaltyLiters,
        })
        // Asking for cost without costs falls back, so keep only what was asked for.
        if (shipment && shipment.priority === p) shipments.set(p, shipment)
      }
    }
    return { fits, shipments, complete }
  }, [settingsOk, products, weightUnit, maxKg, protectionKg, lossCm, off, mode, boxes, settings])

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

  const tooBig = boxes.filter((b) => !off.includes(b.id) && !boxAllowed(b, mode))
  const anyReady = result !== null && result.fits.some((f) => f !== null)
  const firstTable = result ? result.fits.findIndex((f) => f !== null && f.some((x) => x.capacity > 0)) : -1
  const names = readings.map((r) => r.name)

  // What a proposta would keep of the page right now.
  const input: ProposalInput = {
    weightUnit,
    products: products.map(({ id: _, ...p }) => p),
    shipping: { modeId, maxWeight, protection, loss, off },
    priority: active ?? priority,
  }
  const current = shipment ? summarize(shipment, names, mode) : null
  const changed = record !== null && JSON.stringify(input) !== record.input

  const chooseMode = (next: ShippingMode) => {
    setModeId(next.id)
    setMaxWeight(num(next.maxGrossKg))
    remember({ modeId: next.id })
  }
  const toggleBox = (id: string) => {
    const next = off.includes(id) ? off.filter((x) => x !== id) : [...off, id]
    setOff(next)
    remember({ off: next })
  }

  const save = async () => {
    const draft = {
      number,
      responsible,
      input,
      result: current ?? { ...EMPTY_RESULT, priority: input.priority, mode: mode.label },
    }
    const checked = readDraft(draft)
    // Freight is optional, but once a carrier is chosen the rest is needed.
    const freightChecked = checkFreight(freight, settings.carriers, null)
    const problems = [
      ...('problems' in checked ? checked.problems : []),
      ...(freightChecked && 'problems' in freightChecked ? freightChecked.problems.map((p) => `Frete: ${p}`) : []),
    ]
    if ('problems' in checked || problems.length > 0) {
      setSaving({ state: 'refused', problems })
      return
    }
    setSaving({ state: 'saving' })
    let done: { id: number; savedAt: string }
    try {
      done = await saveProposal(checked.draft)
      setRecord({
        id: done.id,
        number: number.trim(),
        responsible: responsible.trim(),
        savedAt: done.savedAt,
        correctedAt: null,
        input: JSON.stringify(input),
        result: checked.draft.result,
        loaded: false,
      })
      setFreightHistory([])
      setSaving({ state: 'idle' })
      // The address now points at the saved proposta, without reloading the page.
      history.replaceState(null, '', `#proposta/${done.id}`)
    } catch (error) {
      setSaving({ state: 'refused', problems: [(error as Error).message] })
      return
    }
    if (freightChecked && 'draft' in freightChecked) {
      try {
        savedFreight(await sendFreight(done.id, freight, freightChecked.draft), [])
      } catch (error) {
        setSaving({
          state: 'refused',
          problems: [
            `A proposta foi salva, mas o frete não: ${(error as Error).message} Tente de novo com "Atualizar frete".`,
          ],
        })
      }
    }
  }

  const savePanel = (
    <section className="save" aria-live="polite">
      {record && !changed && (
        <p className="save-status">
          {record.loaded ? 'Proposta carregada' : 'Proposta salva'}: <strong>{record.number}</strong>,
          por {record.responsible}, em {when(record.savedAt)}
          {record.correctedAt &&
            `. Número ou responsável corrigido pelo administrador em ${when(record.correctedAt)}`}
          .
        </p>
      )}
      {record && !changed && record.loaded && current && !sameBoxes(record.result, current) && (
        <p className="note note-limit">
          O cálculo de hoje dá um resultado diferente do salvo. Salvo: {record.result.headline}. Hoje:{' '}
          {current.headline}. Caixas, regras ou o cálculo mudaram desde então.
        </p>
      )}
      {record && changed && (
        <p className="save-status">
          Alterada desde a proposta {record.number}. Para salvar, use um número de proposta novo.
        </p>
      )}
      {saving.state === 'refused' && (
        <ul className="problems" role="alert">
          {saving.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="save-button"
        onClick={save}
        disabled={saving.state === 'saving'}
      >
        {saving.state === 'saving' ? 'Salvando…' : 'Salvar proposta'}
      </button>
    </section>
  )

  return (
    <main className="page">
      {settingsStatus === 'fallback' && (
        <ul className="problems" role="alert">
          <li>
            Não foi possível carregar as configurações do servidor; o cálculo usa os valores de
            fábrica. Confira a internet e recarregue a página.
          </li>
        </ul>
      )}

      <fieldset className="proposal">
        <legend>Proposta</legend>
        <div className="proposal-fields">
          <Field
            label="Nº da proposta"
            inputMode="text"
            value={number}
            onChange={(v) => {
              setNumber(v)
              if (saving.state === 'refused') setSaving({ state: 'idle' })
            }}
          />
          <Field
            label="Responsável"
            inputMode="text"
            value={responsible}
            onChange={(v) => {
              setResponsible(v)
              if (saving.state === 'refused') setSaving({ state: 'idle' })
            }}
          />
        </div>
        <p className="hint">Só são obrigatórios para salvar a proposta, junto com o nome de cada produto.</p>
      </fieldset>

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
            options={modes}
            value={modeId}
            onChange={(id) => chooseMode(modes.find((m) => m.id === id) ?? mode)}
          />
          <div className="row-2">
            <Field
              label="Limite por caixa"
              suffix="kg"
              value={maxWeight}
              onChange={setMaxWeight}
            />
            <Field
              label="Proteção por caixa"
              suffix="kg"
              value={protection}
              onChange={(v) => {
                setProtection(v)
                remember({ protection: v })
              }}
            />
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
            {boxes.map((b) => (
              <label className="check" key={b.id}>
                <input type="checkbox" checked={!off.includes(b.id)} onChange={() => toggleBox(b.id)} />
                <span>
                  {b.name}
                  <small>{dims(b.dims)}</small>
                </span>
              </label>
            ))}
          </div>
        </details>

        <FreightPanel
          form={freight}
          onChange={setFreight}
          carriers={settings.carriers}
          factor={settings.chargeFactor}
          current={freightHistory[0] ?? null}
          history={freightHistory}
          saved={record ? { id: record.id, number: record.number } : null}
          onSaved={(f) => savedFreight(f, freightHistory)}
        />
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
            names={names}
            allowances={readings.map((r) =>
              r.fragile ? fragileFactor(r.maxLayers, settings.fragileLoad) : null,
            )}
            lossMm={toMm(lossCm)}
            hasWeight={readings.some((r) => r.unit.weightKg > 0)}
            number={number.trim()}
            responsible={responsible.trim()}
          >
            {savePanel}
          </ShipmentLabel>
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
                  {list(boxes.filter((b) => off.includes(b.id)).map((b) => b.name))}.
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
  )
}

/** Stands in for the plan when there is none yet, so saving can say what is missing. */
const EMPTY_RESULT: Omit<ProposalResult, 'priority' | 'mode'> = {
  headline: '',
  totalBoxes: 0,
  volumeM3: 0,
  grossKg: 0,
  cubedKg: 0,
  chargeableKg: 0,
  lines: [],
}
