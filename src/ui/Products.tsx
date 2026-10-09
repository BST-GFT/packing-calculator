/** The products of the order: one row per product, added and removed freely. */

import { FRAGILE_LOAD } from '../data/products.ts'
import { Field, Segmented } from './controls.tsx'
import { productColor } from './format.ts'

/** What was typed for one product, kept as text until it is calculated. */
export interface ProductInput {
  id: number
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

export const blankProduct = (id: number): ProductInput => ({
  id,
  name: '',
  length: '',
  width: '',
  height: '',
  weight: '',
  quantity: '',
  layerLimit: '',
  upright: false,
  fragile: false,
})

/** What a product is called on the page: the name typed, or "Produto 2". */
export const productName = (p: ProductInput, index: number): string =>
  p.name.trim() || `Produto ${index + 1}`

export function Products({
  products,
  onChange,
  weightUnit,
  onWeightUnit,
}: {
  products: ProductInput[]
  onChange: (products: ProductInput[]) => void
  weightUnit: 'g' | 'kg'
  onWeightUnit: (unit: 'g' | 'kg') => void
}) {
  const many = products.length > 1
  const update = (id: number, change: Partial<ProductInput>) =>
    onChange(products.map((p) => (p.id === id ? { ...p, ...change } : p)))
  const add = () => onChange([...products, blankProduct(Math.max(...products.map((p) => p.id)) + 1)])
  const remove = (id: number) => onChange(products.filter((p) => p.id !== id))

  return (
    <fieldset className="products">
      <legend>{many ? 'Produtos' : 'Produto'}</legend>
      <div className="products-top">
        <p className="hint">Medidas e peso de uma unidade, já na embalagem dela.</p>
        <Segmented
          label="Peso em"
          options={[
            { id: 'g', label: 'g' },
            { id: 'kg', label: 'kg' },
          ]}
          value={weightUnit}
          onChange={(id) => onWeightUnit(id === 'kg' ? 'kg' : 'g')}
        />
      </div>

      <div className="product-list">
      {/* Column titles, shown when the products are laid out as table rows. */}
      <div className="product-head" aria-hidden="true">
        <span>Produto</span>
        <span>C (cm)</span>
        <span>L (cm)</span>
        <span>A (cm)</span>
        <span>Peso ({weightUnit})</span>
        <span>Quantidade</span>
        <span>Máx. camadas</span>
        <span>Em pé</span>
        <span>Frágil</span>
        <span />
      </div>

      {products.map((p, i) => (
        <div className="product" key={p.id} role="group" aria-label={productName(p, i)}>
          <div className="product-name">
            {many && <span className="chip" style={{ background: productColor(i) }} aria-hidden="true" />}
            <Field
              label="Nome (opcional)"
              inputMode="text"
              placeholder={`Produto ${i + 1}`}
              value={p.name}
              onChange={(name) => update(p.id, { name })}
            />
          </div>
          <Field className="p-length" label="Comprimento" suffix="cm" value={p.length} onChange={(length) => update(p.id, { length })} />
          <Field className="p-width" label="Largura" suffix="cm" value={p.width} onChange={(width) => update(p.id, { width })} />
          <Field className="p-height" label="Altura" suffix="cm" value={p.height} onChange={(height) => update(p.id, { height })} />
          <Field
            className="p-weight"
            label={`Peso (${weightUnit})`}
            value={p.weight}
            onChange={(weight) => update(p.id, { weight })}
          />
          <Field
            className="p-quantity"
            label="Quantidade"
            inputMode="numeric"
            value={p.quantity}
            onChange={(quantity) => update(p.id, { quantity })}
          />
          <Field
            className="p-layers"
            label="Máx. camadas"
            inputMode="numeric"
            placeholder="Sem limite"
            value={p.layerLimit}
            onChange={(layerLimit) => update(p.id, { layerLimit })}
          />
          <label className="check p-upright">
            <input
              type="checkbox"
              checked={p.upright}
              onChange={(e) => update(p.id, { upright: e.target.checked })}
            />
            <span>Em pé</span>
          </label>
          <label className="check p-fragile">
            <input
              type="checkbox"
              checked={p.fragile}
              onChange={(e) => update(p.id, { fragile: e.target.checked })}
            />
            <span>Frágil</span>
          </label>
          {many && (
            <button
              type="button"
              className="remove"
              aria-label={`Remover ${productName(p, i)}`}
              onClick={() => remove(p.id)}
            >
              ×
            </button>
          )}
        </div>
      ))}
      </div>

      <button type="button" className="add" onClick={add}>
        + Adicionar produto
      </button>
      <p className="hint">
        <strong>Em pé:</strong> a altura fica sempre na vertical, para líquidos.{' '}
        <strong>Máx. camadas:</strong> quantas unidades podem ficar uma sobre a outra, contando outros
        produtos apoiados em cima; vazio é sem limite. <strong>Frágil:</strong> numa caixa com outros
        produtos, vai por cima deles. Sobre cada unidade, outros produtos somam no máximo{' '}
        {FRAGILE_LOAD} vezes o peso dela, ou (Máx. camadas − 1) vezes se esse campo estiver
        preenchido. Informe o peso para isso valer.
      </p>
    </fieldset>
  )
}
