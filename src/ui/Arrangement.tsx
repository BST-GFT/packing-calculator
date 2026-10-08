import { lazy, Suspense } from 'react'

import type { BoxFit, LayerType } from '../engine/index.ts'
import { ALONG, AXIS, count, num } from './format.ts'

// three.js is large, so the 3D view is fetched only once a box is shown.
const Box3D = lazy(() => import('./Box3D.tsx').then((m) => ({ default: m.Box3D })))

/** Beyond this many units a layer is described in words instead of drawn. */
const MAX_DRAWN = 1500

/**
 * How to arrange the units inside one box: the whole box in 3D, then a drawing
 * and a line of text per kind of layer.
 */
export function Arrangement({ fit }: { fit: BoxFit }) {
  if (fit.spaceCapacity === 0) return null
  const upright = fit.stackAxis === 'height'
  const { u, v } = fit.plane

  return (
    <div className="arrangement">
      <Suspense fallback={<div className="view3d-canvas view3d-loading">Carregando 3D…</div>}>
        <Box3D fit={fit} />
      </Suspense>
      {!upright && (
        <p className="note">
          Nesta caixa cabe mais com as camadas em pé, uma atrás da outra {ALONG[fit.stackAxis]}. Os
          desenhos das camadas mostram a caixa vista de lado.
        </p>
      )}
      {fit.limitedBy === 'weight' && (
        <p className="note note-weight">
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
