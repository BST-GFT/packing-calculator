/** The plan for the order, drawn like a shipping label. */

import type { ShippingMode } from '../data/shipping.ts'
import { freightWeight, type Priority, type Shipment, type ShipmentLine } from '../engine/index.ts'
import { Arrangement, MixedArrangement } from './Arrangement.tsx'
import { brl, count, kg, list, m3, num, pct } from './format.ts'

export const PRIORITY_LABEL: Record<Priority, string> = {
  cost: 'Menor custo',
  boxes: 'Menos caixas',
  volume: 'Menor volume',
  balanced: 'Equilíbrio entre caixas e volume',
}

/** Identifies a shipment's boxes, to tell apart plans that differ. */
export const shipmentKey = (s: Shipment): string =>
  s.lines
    .map((l) => `${l.box.id}:${l.boxes}:${l.contents.map((c) => `${c.product}=${c.units}`).join(',')}`)
    .join('|')

export function ShipmentLabel({
  shipment,
  priority,
  mode,
  alternatives,
  onPick,
  names,
  allowances,
  lossMm,
  hasWeight,
}: {
  shipment: Shipment
  priority: Priority
  mode: ShippingMode
  alternatives: Array<{ priority: Priority; shipment: Shipment }>
  onPick: (priority: Priority) => void
  /** Product names, in product order. */
  names: string[]
  /** Per product, how many times its weight a fragile unit carries in other products; null if not fragile. */
  allowances: Array<number | null>
  /** Space lost on each box dimension, mm. */
  lossMm: number
  hasWeight: boolean
}) {
  const many = names.length > 1
  const weights = freightWeight(shipment, mode.cubage)
  const units = shipment.lines.reduce(
    (sum, l) => sum + l.boxes * l.contents.reduce((n, c) => n + c.units, 0),
    0,
  )

  // Boxes of each size, largest first as the lines are, for the headline.
  const sizes: Array<{ name: string; boxes: number }> = []
  for (const line of shipment.lines) {
    const size = sizes.find((s) => s.name === line.box.name)
    if (size) size.boxes += line.boxes
    else sizes.push({ name: line.box.name, boxes: line.boxes })
  }
  const headline =
    sizes.length === 1
      ? `${count(shipment.totalBoxes, 'caixa', 'caixas')} ${sizes[0].name}`
      : `${count(shipment.totalBoxes, 'caixa', 'caixas')}: ${list(sizes.map((s) => `${num(s.boxes, 0)} ${s.name}`))}`

  const contents = (line: ShipmentLine) =>
    many
      ? list(line.contents.map((c) => `${num(c.units, 0)} ${names[c.product]}`))
      : count(line.contents[0].units, 'unidade', 'unidades')

  // One drawing per layout: a box size with one product, or a mixed box.
  const layouts: ShipmentLine[] = []
  for (const line of shipment.lines) {
    const same = (other: ShipmentLine) =>
      !line.placed &&
      !other.placed &&
      other.box.id === line.box.id &&
      other.contents[0].product === line.contents[0].product
    if (!layouts.some(same)) layouts.push(line)
  }

  return (
    <article className="plan">
      <header className="plan-head">
        <div>
          <h2>{headline}</h2>
          <p>
            {many
              ? `${count(units, 'unidade', 'unidades')} de ${names.length} produtos.`
              : `${count(units, 'unidade', 'unidades')}${
                  shipment.spareUnits
                    ? `, com espaço sobrando para mais ${num(shipment.spareUnits, 0)}`
                    : ', sem espaço sobrando'
                }.`}
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
            <dd>{kg(shipment.grossKg)}</dd>
          </div>
        )}
        <div>
          <dt>Volume</dt>
          <dd>{m3(shipment.volumeM3)}</dd>
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
          <dd>{pct(shipment.fill)}</dd>
        </div>
        {shipment.costBRL !== null && (
          <div>
            <dt>Custo</dt>
            <dd>{brl(shipment.costBRL)}</dd>
          </div>
        )}
      </dl>

      <ul className="lines">
        {shipment.lines.map((line, i) => (
          <li key={i}>
            <span className="tag">{line.box.name}</span>
            <span className="line-main">
              {count(line.boxes, 'caixa', 'caixas')} com {contents(line)}
              {line.boxes > 1 ? ' cada' : ''}
              {line.placed && <small>produtos misturados</small>}
              {line.partial && line.fit && (
                <small>incompleta, cabem {num(line.fit.capacity, 0)}</small>
              )}
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

      {layouts.map((line, i) => (
        <section className="how" key={i}>
          <h3>
            Como arrumar a caixa <span className="tag">{line.box.name}</span>
            {many && ` com ${list(line.contents.map((c) => names[c.product]))}`}
          </h3>
          {line.placed ? (
            <MixedArrangement line={line} names={names} lossMm={lossMm} allowances={allowances} />
          ) : (
            line.fit && <Arrangement fit={line.fit} product={many ? line.contents[0].product : undefined} />
          )}
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
                {count(a.shipment.totalBoxes, 'caixa', 'caixas')}, {m3(a.shipment.volumeM3)}
              </button>
            ))}
          </div>
        )}
      </footer>
    </article>
  )
}
