import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseMoney } from '../ui/format.ts'
import { idealCharge, readFreight } from './freight.ts'

const CARRIERS = [
  { name: 'Sedex', tracking: true },
  { name: 'Jadlog', tracking: false },
]

/** Freight as the page sends it. */
const sent = (change: Record<string, unknown> = {}) => ({
  carrier: 'Sedex',
  quotedBRL: 85.5,
  chargedBRL: 120,
  quoteDate: '2026-10-14',
  tracking: '',
  ...change,
})

describe('saving freight', () => {
  it('takes complete freight, with names and amounts tidied', () => {
    const read = readFreight(sent({ carrier: ' sedex ', quotedBRL: 85.499, tracking: ' AB123456789BR ' }), CARRIERS)
    assert.deepEqual(read, {
      freight: {
        carrier: 'Sedex',
        quotedBRL: 85.5,
        chargedBRL: 120,
        quoteDate: '2026-10-14',
        tracking: 'AB123456789BR',
        trackingNeeded: true,
      },
    })
  })

  it('leaves the tracking code for later', () => {
    const read = readFreight(sent(), CARRIERS)
    assert.ok('freight' in read)
    assert.equal(read.freight.tracking, '')
  })

  it('needs every value once a carrier is chosen', () => {
    assert.deepEqual(readFreight(sent({ quotedBRL: NaN, chargedBRL: 0, quoteDate: '' }), CARRIERS), {
      problems: [
        'Informe o valor informado pela transportadora.',
        'Informe o valor cobrado do cliente.',
        'Informe a data da cotação.',
      ],
    })
    assert.deepEqual(readFreight(sent({ carrier: '' }), CARRIERS), { problems: ['Escolha a transportadora.'] })
  })

  it('takes only carriers on the list, or the one the proposta already has', () => {
    assert.deepEqual(readFreight(sent({ carrier: 'Correios' }), CARRIERS), {
      problems: ['Escolha uma transportadora da lista.'],
    })
    const kept = readFreight(sent({ carrier: 'Braspress' }), CARRIERS, { carrier: 'Braspress', trackingNeeded: false })
    assert.ok('freight' in kept)
    assert.equal(kept.freight.trackingNeeded, false)
  })

  it('refuses days that do not exist', () => {
    for (const quoteDate of ['2026-02-30', '14/10/2026', '2019-12-31']) {
      assert.ok('problems' in readFreight(sent({ quoteDate }), CARRIERS), quoteDate)
    }
  })

  it('refuses anything shaped differently', () => {
    for (const value of [null, [], 'x', sent({ carrier: 1 }), sent({ tracking: undefined })]) {
      assert.ok('problems' in readFreight(value, CARRIERS))
    }
  })

  it('works out the ideal charge to the cent', () => {
    assert.equal(idealCharge(85.5, 1.4), 119.7)
    assert.equal(idealCharge(10.01, 1.4), 14.01)
  })
})

describe('reading money', () => {
  it('reads amounts as people type them', () => {
    const cases: Array<[string, number]> = [
      ['120', 120],
      ['85,5', 85.5],
      ['1.234,50', 1234.5],
      ['R$ 1.234,50', 1234.5],
      ['1.234', 1234],
      ['12.5', 12.5],
      ['1234.56', 1234.56],
    ]
    for (const [text, value] of cases) assert.equal(parseMoney(text), value, text)
    for (const text of ['', 'abc', '1,2,3']) assert.ok(Number.isNaN(parseMoney(text)), text)
  })
})
