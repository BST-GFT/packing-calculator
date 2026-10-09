import { lazy, Suspense, useMemo } from 'react'

import { placeUnits, toMm, type BoxFit, type LayerType, type ShipmentLine } from '../engine/index.ts'
import type { Contents } from './Box3D.tsx'
import { ALONG, AXIS, count, list, num, productColor } from './format.ts'

// three.js is large, so the 3D view is fetched only once a box is shown.
const Box3D = lazy(() => import('./Box3D.tsx').then((m) => ({ default: m.Box3D })))

/** Beyond this many units a layer is described in words instead of drawn. */
const MAX_DRAWN = 1500

/** Beyond this many units the box is not drawn in 3D. */
const MAX_3D = 20_000

function View3D(contents: Contents) {
  if (contents.units.length > MAX_3D) {
    return <p className="note">São unidades demais para mostrar em 3D; siga as camadas abaixo.</p>
  }
  return (
    <Suspense fallback={<div className="view3d-canvas view3d-loading">Carregando 3D…</div>}>
      <Box3D {...contents} />
    </Suspense>
  )
}

/**
 * How to arrange the units of one product inside one box: the whole box in 3D,
 * then a drawing and a line of text per kind of layer. In an order of several
 * products, `product` gives the unit colour in 3D.
 */
export function Arrangement({ fit, product }: { fit: BoxFit; product?: number }) {
  const units = useMemo(
    () => placeUnits(fit, Math.min(fit.capacity, MAX_3D + 1), product ?? 0),
    [fit, product],
  )
  if (fit.spaceCapacity === 0) return null
  const upright = fit.stackAxis === 'height'
  const { u, v } = fit.plane

  return (
    <div className="arrangement">
      <View3D
        box={fit.box}
        lossMm={toMm(fit.box.dims[u]) - fit.plane.uMm}
        units={units}
        colorBy={product === undefined ? 'turn' : 'product'}
      />

      {!upright && (
        <p className="note">
          Nesta caixa cabe mais com as camadas em pé, uma atrás da outra {ALONG[fit.stackAxis]}. Os
          desenhos das camadas mostram a caixa vista de lado.
        </p>
      )}
      {fit.limitedBy === 'layers' && (
        <p className="note note-limit">
          Com o limite de {count(fit.maxLayers, 'camada', 'camadas')}, sobra espaço nesta caixa.
        </p>
      )}
      {fit.limitedBy === 'weight' && (
        <p className="note note-limit">
          Pelo espaço caberiam {num(fit.spaceCapacity, 0)}, mas o limite de {num(fit.maxGrossKg)} kg
          permite {count(fit.capacity, 'unidade', 'unidades')} por caixa. Monte as camadas abaixo
          até chegar a esse número.
        </p>
      )}
      <div className="layers">
        {fit.layerTypes.map((layer) => (
          <figure className="layer" key={layer.thicknessCm}>
            <LayerDrawing fit={fit} layer={layer} />
            <figcaption>
              <strong>
                {count(layer.layers, 'camada', 'camadas')} de{' '}
                {count(layer.unitsPerLayer, 'unidade', 'unidades')}
              </strong>
              <span>
                Lado de {num(layer.thicknessCm)} cm {ALONG[fit.stackAxis]}, com {num(layer.footprintCm[0])}{' '}
                × {num(layer.footprintCm[1])} cm apoiado.
              </span>
              <span className="axes">
                {upright ? 'Vista de cima' : 'Vista de lado'}: {AXIS[u]} {num(fit.box.dims[u])} cm ×{' '}
                {AXIS[v]} {num(fit.box.dims[v])} cm
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}

function LayerDrawing({ fit, layer }: { fit: BoxFit; layer: LayerType }) {
  const { uMm, vMm } = fit.plane
  if (layer.rects.length > MAX_DRAWN) {
    return <p className="note">São muitas unidades para desenhar; siga a contagem ao lado.</p>
  }
  // Units lying the other way round are tinted so the turn is easy to spot.
  const reference = layer.rects[0]?.w
  // In a side view the floor of the box belongs at the bottom of the drawing.
  const floorDown = fit.plane.v === 'height'
  return (
    <svg
      className="layer-drawing"
      viewBox={`0 0 ${uMm} ${vMm}`}
      style={{ aspectRatio: `${uMm} / ${vMm}` }}
      role="img"
      aria-label={`Camada com ${layer.unitsPerLayer} unidades`}
    >
      <rect className="carton" x={0} y={0} width={uMm} height={vMm} />
      {layer.rects.map((r, i) => (
        <rect
          key={i}
          className={r.w === reference ? 'unit' : 'unit unit-turned'}
          x={r.x}
          y={floorDown ? vMm - r.y - r.h : r.y}
          width={r.w}
          height={r.h}
        />
      ))}
    </svg>
  )
}

/**
 * How to pack a box that mixes products: the box in 3D, coloured by product,
 * then what goes in each layer from the bottom up. `allowances` gives, per
 * product, how many times its weight a fragile unit carries in other
 * products, or null for a product that is not fragile.
 */
export function MixedArrangement({
  line,
  names,
  lossMm,
  allowances,
}: {
  line: ShipmentLine
  names: string[]
  lossMm: number
  allowances: Array<number | null>
}) {
  const units = line.placed ?? []
  // Units of each product in each layer, bottom first.
  const layers: Array<Map<number, number>> = []
  for (const u of units) {
    const layer = (layers[u.layer] ??= new Map())
    layer.set(u.product, (layer.get(u.product) ?? 0) + 1)
  }
  // Layers holding the same, such as a pile of bags, are listed once.
  const steps: Array<{ from: number; to: number; text: string }> = []
  layers.forEach((layer, i) => {
    const text = list(
      [...layer].sort((a, b) => a[0] - b[0]).map(([p, n]) => `${num(n, 0)} ${names[p]}`),
    )
    const last = steps[steps.length - 1]
    if (last && last.text === text && last.to === i - 1) last.to = i
    else steps.push({ from: i, to: i, text })
  })
  const fragile = (product: number) => allowances[product] !== null
  const allowed = (factor: number) =>
    factor === 0
      ? 'nada de outro produto vai sobre suas unidades'
      : `sobre cada unidade outros produtos somam no máximo ${
          factor === 1 ? 'o próprio peso dela' : `${num(factor, 0)} vezes o peso dela`
        }`

  return (
    <div className="arrangement">
      <View3D box={line.box} lossMm={lossMm} units={units} colorBy="product" />
      <ul className="legend">
        {line.contents.map((c) => (
          <li key={c.product}>
            <span className="chip" style={{ background: productColor(c.product) }} aria-hidden="true" />
            {names[c.product]}
            {fragile(c.product) && <small>frágil</small>}
          </li>
        ))}
      </ul>
      {line.contents
        .filter((c) => fragile(c.product))
        .map((c) => (
          <p className="note" key={c.product}>
            {names[c.product]} é frágil: vai por cima, e {allowed(allowances[c.product]!)}.
          </p>
        ))}
      <ol className="steps">
        {steps.map((step) => (
          <li key={step.from}>
            <strong>
              {step.from === step.to
                ? `Camada ${step.from + 1}`
                : `Camadas ${step.from + 1} a ${step.to + 1}`}
            </strong>
            <span>
              {step.text}
              {step.from === step.to ? '' : ' em cada'}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
