import { Fragment, useEffect, useId, useMemo, useState } from 'react'

import logoUrl from './assets/logo.jpg'
import { BOXES, BOX_PENALTY_LITERS, DEFAULT_LOSS_CM } from './data/boxes.ts'
import { SHIPPING_MODES, boxAllowed, type ShippingMode } from './data/shipping.ts'
import {
  fitUnitInBox,
  freightWeight,
  grossKg,
  planOrder,
  type BoxFit,
  type PackingRules,
  type Plan,
  type Priority,
  type Unit,
} from './engine/index.ts'
import { Arrangement } from './ui/Arrangement.tsx'
import { brl, count, dims, kg, list, m3, num, parseDecimal, pct } from './ui/format.ts'

const STORAGE_KEY = 'packing-calculator:settings'
const MAX_QUANTITY = 5_000_000
const MAX_SIDE_CM = 300

const PRIORITY_LABEL: Record<Priority, string> = {
  cost: 'Menor custo',
  balanced: 'Equilíbrio entre caixas e volume',
  boxes: 'Menos caixas',
  volume: 'Menor volume',
}

/** Shipping settings are remembered on this device; the product is typed in each time. */
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

const planKey = (plan: Plan): string =>
  plan.lines.map((l) => `${l.fit.box.id}:${l.boxes}:${l.unitsPerBox}`).join('|')

export function App() {
  const [saved] = useState(loadSaved)

  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [weightUnit, setWeightUnit] = useState<'g' | 'kg'>('g')
  const [quantity, setQuantity] = useState('')
  const [layerLimit, setLayerLimit] = useState('')
  const [upright, setUpright] = useState(false)

  const [modeId, setModeId] = useState(() =>
    SHIPPING_MODES.some((m) => m.id === saved.modeId) ? saved.modeId! : SHIPPING_MODES[0].id,
  )
  const mode = SHIPPING_MODES.find((m) => m.id === modeId) ?? SHIPPING_MODES[0]
  const [maxWeight, setMaxWeight] = useState(() => text(saved.maxWeight, num(mode.maxGrossKg)))
  const [protection, setProtection] = useState(() => text(saved.protection, '0'))
  const [loss, setLoss] = useState(() => text(saved.loss, num(DEFAULT_LOSS_CM)))
  const [off, setOff] = useState<string[]>(() => (Array.isArray(saved.off) ? saved.off : []))

  const [priority, setPriority] = useState<Priority>(
    BOXES.every((b) => b.costBRL !== undefined) ? 'cost' : 'balanced',
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

  const l = parseDecimal(length)
  const w = parseDecimal(width)
  const h = parseDecimal(height)
  const weightTyped = weight.trim() === '' ? 0 : parseDecimal(weight)
  const unitWeightKg = weightUnit === 'g' ? weightTyped / 1000 : weightTyped
  const qty = quantity.trim() === '' ? 0 : parseDecimal(quantity)
  const maxLayers = layerLimit.trim() === '' ? Infinity : parseDecimal(layerLimit)
  const maxKg = parseDecimal(maxWeight)
  const protectionKg = parseDecimal(protection)
  const lossCm = parseDecimal(loss)

  const sideOk = (n: number) => n > 0 && n <= MAX_SIDE_CM
  const dimsTyped = [length, width, height].every((s) => s.trim() !== '')
  const dimsOk = sideOk(l) && sideOk(w) && sideOk(h)
  const qtyOk = Number.isInteger(qty) && qty >= 1 && qty <= MAX_QUANTITY
  const layersOk = maxLayers === Infinity || (Number.isInteger(maxLayers) && maxLayers >= 1)

  const problems: string[] = []
  if ([length, width, height].some((s, i) => s.trim() !== '' && !sideOk([l, w, h][i]))) {
    problems.push(`As medidas da unidade devem ser números entre 0 e ${MAX_SIDE_CM} cm.`)
  }
  if (!(unitWeightKg >= 0)) problems.push('O peso da unidade deve ser um número.')
  if (quantity.trim() !== '' && !qtyOk) {
    problems.push(`A quantidade deve ser um número inteiro de 1 a ${num(MAX_QUANTITY, 0)}.`)
  }
  if (!layersOk) {
    problems.push('O máximo de camadas deve ser um número inteiro a partir de 1, ou vazio para não limitar.')
  }
  if (!(maxKg > 0)) problems.push('Informe o limite de peso por caixa.')
  if (!(protectionKg >= 0)) problems.push('A proteção por caixa deve ser um número, ou zero.')
  if (!(lossCm >= 0)) problems.push('A folga interna deve ser um número, ou zero.')

  const settingsOk = unitWeightKg >= 0 && layersOk && maxKg > 0 && protectionKg >= 0 && lossCm >= 0

  const result = useMemo(() => {
    if (!dimsOk || !settingsOk) return null
    const unit: Unit = { dims: { length: l, width: w, height: h }, weightKg: unitWeightKg }
    const rules: PackingRules = {
      maxGrossKg: maxKg,
      protectionKg,
      lossCm,
      keepUpright: upright,
      maxLayers,
    }
    const fits = BOXES.filter((b) => !off.includes(b.id) && boxAllowed(b, mode)).map((b) =>
      fitUnitInBox(unit, b, rules),
    )
    const plans = new Map<Priority, Plan>()
    if (qtyOk) {
      for (const p of ['cost', 'balanced', 'boxes', 'volume'] as const) {
        const plan = planOrder(fits, qty, p, { boxPenaltyLiters: BOX_PENALTY_LITERS })
        // Asking for cost without costs falls back, so keep only what was asked for.
        if (plan && plan.priority === p) plans.set(p, plan)
      }
    }
    return { fits, plans }
  }, [dimsOk, settingsOk, qtyOk, l, w, h, unitWeightKg, qty, maxKg, protectionKg, lossCm, upright, maxLayers, off, mode])

  const active: Priority | null = result
    ? result.plans.has(priority)
      ? priority
      : ([...result.plans.keys()][0] ?? null)
    : null
  const plan = active && result ? (result.plans.get(active) ?? null) : null

  // Other ways of choosing the boxes, when they give a different answer.
  const alternatives: Array<{ priority: Priority; plan: Plan }> = []
  if (plan && result) {
    const seen = new Set([planKey(plan)])
    for (const [p, other] of result.plans) {
      if (seen.has(planKey(other))) continue
      seen.add(planKey(other))
      alternatives.push({ priority: p, plan: other })
    }
  }

  const tooBig = BOXES.filter((b) => !off.includes(b.id) && !boxAllowed(b, mode))
  const nothingFits = result !== null && result.fits.every((f) => f.capacity === 0)

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
        <form className="inputs" onSubmit={(e) => e.preventDefault()}>
          <fieldset>
            <legend>Produto</legend>
            <p className="hint">Medidas e peso de uma unidade, já na embalagem dela.</p>
            <div className="row-3">
              <Field label="Comprimento" suffix="cm" value={length} onChange={setLength} />
              <Field label="Largura" suffix="cm" value={width} onChange={setWidth} />
              <Field label="Altura" suffix="cm" value={height} onChange={setHeight} />
            </div>
            <div className="row-weight">
              <Field label="Peso da unidade" value={weight} onChange={setWeight} />
              <Segmented
                label="Unidade de peso"
                options={[
                  { id: 'g', label: 'g' },
                  { id: 'kg', label: 'kg' },
                ]}
                value={weightUnit}
                onChange={(id) => setWeightUnit(id === 'kg' ? 'kg' : 'g')}
              />
            </div>
            <Field
              label="Quantidade do pedido"
              inputMode="numeric"
              value={quantity}
              onChange={setQuantity}
            />
            <Field
              label="Máximo de camadas"
              inputMode="numeric"
              placeholder="Sem limite"
              value={layerLimit}
              onChange={setLayerLimit}
              hint="Quantas unidades podem ficar uma sobre a outra."
            />
            <label className="check">
              <input type="checkbox" checked={upright} onChange={(e) => setUpright(e.target.checked)} />
              <span>
                Manter em pé
                <small>Para líquidos e itens frágeis. A altura informada fica sempre na vertical.</small>
              </span>
            </label>
          </fieldset>

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

          {problems.length > 0 && (
            <ul className="problems" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </form>

        <section className="results" aria-live="polite">
          {!result && (
            <p className="empty">
              {dimsTyped && problems.length > 0
                ? 'Corrija os campos indicados para ver o resultado.'
                : 'Informe as medidas da unidade para ver quantas cabem em cada caixa.'}
            </p>
          )}

          {result && nothingFits && (
            <p className="empty">
              Esta unidade não cabe em nenhuma das caixas disponíveis
              {upright ? ' mantendo-a em pé' : ''}. Confira as medidas, a folga interna e o limite
              de peso.
            </p>
          )}

          {plan && active && (
            <PlanLabel
              plan={plan}
              priority={active}
              mode={mode}
              alternatives={alternatives}
              onPick={setPriority}
            />
          )}

          {result && !nothingFits && (
            <section className="capacity">
              <h2>Quantas cabem em cada caixa</h2>
              {!plan && !quantity.trim() && (
                <p className="hint">Informe a quantidade do pedido para montar o plano de caixas.</p>
              )}
              {off.length > 0 && (
                <p className="hint">
                  Fora do cálculo, desmarcadas em Envio:{' '}
                  {list(BOXES.filter((b) => off.includes(b.id)).map((b) => b.name))}.
                </p>
              )}
              {tooBig.length > 0 && (
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
                  {result.fits.map((fit) => (
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
                          {fit.capacity > 0 && unitWeightKg > 0 ? kg(grossKg(fit, fit.capacity)) : ''}
                        </td>
                        <td>
                          {fit.spaceCapacity > 0 && (
                            <button
                              type="button"
                              className="link"
                              aria-expanded={open === fit.box.id}
                              onClick={() => setOpen(open === fit.box.id ? null : fit.box.id)}
                            >
                              {open === fit.box.id ? 'Fechar' : 'Ver arranjo'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {open === fit.box.id && (
                        <tr className="detail">
                          <td colSpan={5}>
                            <Arrangement fit={fit} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {result && (
            <p className="disclaimer">
              O cálculo é geométrico: não considera fragilidade, deformação da embalagem nem
              amassamento. Confira a primeira caixa montada antes de fechar o frete.
            </p>
          )}
        </section>
      </main>
    </>
  )
}

function PlanLabel({
  plan,
  priority,
  mode,
  alternatives,
  onPick,
}: {
  plan: Plan
  priority: Priority
  mode: ShippingMode
  alternatives: Array<{ priority: Priority; plan: Plan }>
  onPick: (priority: Priority) => void
}) {
  const weights = freightWeight(plan, mode.cubage)
  const hasWeight = plan.lines[0].fit.unit.weightKg > 0

  // One entry per box size, largest first, for the headline and the drawings.
  const sizes: Array<{ fit: BoxFit; boxes: number }> = []
  for (const line of plan.lines) {
    const entry = sizes.find((s) => s.fit.box.id === line.fit.box.id)
    if (entry) entry.boxes += line.boxes
    else sizes.push({ fit: line.fit, boxes: line.boxes })
  }
  const headline =
    sizes.length === 1
      ? `${count(plan.totalBoxes, 'caixa', 'caixas')} ${sizes[0].fit.box.name}`
      : `${count(plan.totalBoxes, 'caixa', 'caixas')}: ${list(sizes.map((s) => `${num(s.boxes, 0)} ${s.fit.box.name}`))}`

  return (
    <article className="plan">
      <header className="plan-head">
        <div>
          <h2>{headline}</h2>
          <p>
            {count(plan.quantity, 'unidade', 'unidades')}
            {plan.spareUnits > 0
              ? `, com espaço sobrando para mais ${num(plan.spareUnits, 0)}`
              : ', sem espaço sobrando'}
            .
          </p>
        </div>
        <button type="button" className="print" onClick={() => window.print()}>
          Imprimir plano
        </button>
      </header>

      <dl className="facts">
        {hasWeight && (
          <div>
            <dt>Peso bruto</dt>
            <dd>{kg(plan.grossKg)}</dd>
          </div>
        )}
        <div>
          <dt>Volume</dt>
          <dd>{m3(plan.volumeM3)}</dd>
        </div>
        <div>
          <dt>Peso cubado</dt>
          <dd>{kg(weights.cubedKg)}</dd>
        </div>
        {hasWeight && (
          <div>
            <dt>Peso taxável</dt>
            <dd>{kg(weights.chargeableKg)}</dd>
          </div>
        )}
        <div>
          <dt>Ocupação</dt>
          <dd>{pct(plan.fill)}</dd>
        </div>
        {plan.costBRL !== null && (
          <div>
            <dt>Custo</dt>
            <dd>{brl(plan.costBRL)}</dd>
          </div>
        )}
      </dl>

      <ul className="lines">
        {plan.lines.map((line) => (
          <li key={`${line.fit.box.id}-${line.partial}`}>
            <span className="tag">{line.fit.box.name}</span>
            <span className="line-main">
              {count(line.boxes, 'caixa', 'caixas')} com{' '}
              {count(line.unitsPerBox, 'unidade', 'unidades')}
              {line.boxes > 1 ? ' cada' : ''}
              {line.partial && <small>incompleta, cabem {num(line.fit.capacity, 0)}</small>}
            </span>
            {hasWeight && (
              <span className="line-weight">
                {kg(line.grossKgPerBox)}
                {line.boxes > 1 ? ' cada' : ''}
              </span>
            )}
          </li>
        ))}
      </ul>

      {sizes.map(({ fit }) => (
        <section className="how" key={fit.box.id}>
          <h3>
            Como arrumar a caixa <span className="tag">{fit.box.name}</span>
          </h3>
          <Arrangement fit={fit} />
        </section>
      ))}

      <footer className="plan-foot">
        <p>
          Critério: {PRIORITY_LABEL[priority].toLowerCase()}. Peso cubado a{' '}
          {num(mode.cubage.kgPerM3, 0)} kg/m³ ({mode.label}).
        </p>
        {alternatives.length > 0 && (
          <div className="alternatives">
            {alternatives.map((a) => (
              <button type="button" key={a.priority} onClick={() => onPick(a.priority)}>
                <strong>{PRIORITY_LABEL[a.priority]}</strong>
                {count(a.plan.totalBoxes, 'caixa', 'caixas')}, {m3(a.plan.volumeM3)}
              </button>
            ))}
          </div>
        )}
      </footer>
    </article>
  )
}

function Field({
  label,
  value,
  onChange,
  suffix,
  hint,
  placeholder,
  inputMode = 'decimal',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  suffix?: string
  hint?: string
  placeholder?: string
  inputMode?: 'decimal' | 'numeric'
}) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="control">
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {suffix && <span aria-hidden="true">{suffix}</span>}
      </div>
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  )
}

function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ id: string; label: string }>
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            type="button"
            key={o.id}
            aria-pressed={o.id === value}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
