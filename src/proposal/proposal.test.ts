import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BOXES } from '../data/boxes.ts'
import { SHIPPING_MODES } from '../data/shipping.ts'
import { fitUnitInBox, planShipment } from '../engine/index.ts'
import { LIMITS, numberKey, readDraft, type ProposalDraft } from './format.ts'
import { headline, sameBoxes, summarize } from './summary.ts'

const rules = { maxGrossKg: 25, protectionKg: 0, lossCm: 0, fragileLoad: 3 }

/** A complete proposta: one product of 500 mugs. */
function draft(): ProposalDraft {
  const product = {
    unit: { dims: { length: 10.5, width: 8, height: 5 }, weightKg: 0.25 },
    quantity: 500,
    keepUpright: false,
    maxLayers: Infinity,
    fragile: false,
  }
  const fits = [BOXES.map((b) => fitUnitInBox(product.unit, b, { ...rules, keepUpright: false }))]
  const shipment = planShipment([product], fits, 'boxes', rules)!
  return {
    number: 'PR-2026-153',
    responsible: 'Ana',
    input: {
      weightUnit: 'g',
      products: [
        {
          name: 'Caneca',
          length: '10,5',
          width: '8',
          height: '5',
          weight: '250',
          quantity: '500',
          layerLimit: '',
          upright: false,
          fragile: false,
        },
      ],
      shipping: { modeId: 'transportadora', maxWeight: '25', protection: '0', loss: '0', off: [] },
      priority: 'boxes',
    },
    result: summarize(shipment, ['Caneca'], SHIPPING_MODES[0]),
  }
}

describe('saving a proposta', () => {
  it('accepts a complete proposta as it is', () => {
    const d = draft()
    assert.deepEqual(readDraft(JSON.parse(JSON.stringify(d))), { draft: d })
  })

  it('asks for the number, the responsible and every product name', () => {
    const d = draft()
    d.number = '  '
    d.responsible = ''
    d.input.products[0].name = ' '
    assert.deepEqual(readDraft(d), {
      problems: [
        'Informe o número da proposta.',
        'Informe o responsável pela proposta.',
        'Dê um nome a cada produto.',
      ],
    })
  })

  it('needs a plan to save', () => {
    const d = draft()
    d.result.lines = []
    assert.ok('problems' in readDraft(d))
  })

  it('refuses anything shaped differently, as from outside the page', () => {
    const broken: unknown[] = [
      null,
      'text',
      [],
      { ...draft(), number: 153 },
      { ...draft(), number: 'x'.repeat(LIMITS.number + 1) },
      { ...draft(), input: { ...draft().input, weightUnit: 'lb' } },
      { ...draft(), input: { ...draft().input, priority: 'cheapest' } },
      { ...draft(), input: { ...draft().input, products: [] } },
      { ...draft(), input: { ...draft().input, products: [{ name: 'Caneca' }] } },
      { ...draft(), input: { ...draft().input, shipping: { ...draft().input.shipping, off: 'P' } } },
      { ...draft(), result: { ...draft().result, totalBoxes: -1 } },
      { ...draft(), result: { ...draft().result, grossKg: Number.NaN } },
      { ...draft(), result: { ...draft().result, lines: [{ box: 'M' }] } },
    ]
    for (const value of broken) {
      const read = readDraft(value)
      assert.ok('problems' in read, JSON.stringify(value)?.slice(0, 80))
      assert.equal(read.problems.length, 1)
    }
  })

  it('treats numbers that differ only in capitals or spacing as the same', () => {
    assert.equal(numberKey('  pr-2026  153 '), numberKey('PR-2026 153'))
    assert.notEqual(numberKey('PR-2026-153'), numberKey('PR-2026-154'))
  })
})

describe('summing up the plan', () => {
  it('keeps the boxes, their contents by name and the headline', () => {
    const result = draft().result
    assert.equal(result.headline, '6 caixas M')
    assert.equal(result.totalBoxes, 6)
    assert.deepEqual(
      result.lines.map((l) => [l.box, l.boxes, l.contents]),
      [
        ['M', 5, [{ product: 'Caneca', units: 85 }]],
        ['M', 1, [{ product: 'Caneca', units: 75 }]],
      ],
    )
  })

  it('tells when a plan ships different boxes', () => {
    const saved = draft().result
    const same = { ...saved, lines: [...saved.lines].reverse(), grossKg: saved.grossKg + 0.1 }
    assert.ok(sameBoxes(saved, same))
    const other = { ...saved, lines: [{ ...saved.lines[0], box: 'G' }, saved.lines[1]] }
    assert.ok(!sameBoxes(saved, other))
  })

  it('names each size once in the headline, with how many', () => {
    const box = (name: string) => BOXES.find((b) => b.name === name)!
    const shipment = {
      totalBoxes: 4,
      lines: [
        { box: box('CM'), boxes: 2 },
        { box: box('M'), boxes: 1 },
        { box: box('CM'), boxes: 1 },
      ],
    } as Parameters<typeof headline>[0]
    assert.equal(headline(shipment), '4 caixas: 3 CM e 1 M')
  })
})
