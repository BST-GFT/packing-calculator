import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { boxId, DEFAULT_SETTINGS, readSettings, type Settings } from './format.ts'

/** The factory settings as they arrive from the page: plain JSON. */
const sent = (): Settings => JSON.parse(JSON.stringify(DEFAULT_SETTINGS))

describe('saving settings', () => {
  it('accepts the factory settings as they are', () => {
    assert.deepEqual(readSettings(sent()), { settings: DEFAULT_SETTINGS })
  })

  it('takes a new box and a changed limit', () => {
    const s = sent()
    s.boxes.push({ id: '', name: ' xg ', dims: { length: 60, width: 40, height: 40 }, emptyWeightKg: 1.2 })
    s.modes[0].maxGrossKg = 28
    s.fragileLoad = 4
    const read = readSettings(s)
    assert.ok('settings' in read)
    const added = read.settings.boxes.at(-1)!
    assert.equal(added.name, 'xg')
    assert.equal(added.id, 'XG')
    assert.equal(read.settings.modes[0].maxGrossKg, 28)
    assert.equal(read.settings.fragileLoad, 4)
  })

  it('says what is wrong with values that cannot be used', () => {
    const s = sent()
    s.boxes[0].dims.length = 0
    s.boxes[1].name = ''
    s.boxes[2].emptyWeightKg = -1
    s.modes[1].cubage.kgPerM3 = 0
    s.lossCm = 50
    const read = readSettings(s)
    assert.ok('problems' in read)
    assert.deepEqual(read.problems, [
      'P: as medidas devem ir de 1 a 300 cm.',
      'Caixa 2: dê um nome de até 10 letras.',
      'G: o peso da caixa vazia deve ir de 0 a 50 kg.',
      'Correios: o fator de cubagem deve ir de 1 a 1.000 kg/m³.',
      'A folga interna deve ir de 0 a 10 cm.',
    ])
  })

  it('refuses two boxes with the same name, whatever the capitals', () => {
    const s = sent()
    s.boxes[1].name = 'p'
    assert.deepEqual(readSettings(s), { problems: ['Duas caixas não podem ter o mesmo nome.'] })
  })

  it('needs at least one box', () => {
    const s = sent()
    s.boxes = []
    assert.deepEqual(readSettings(s), { problems: ['Cadastre pelo menos uma caixa.'] })
  })

  it('keeps the shipping modes as they are, taking only their numbers', () => {
    const s = sent()
    s.modes[0].label = 'Outra'
    s.modes[0].cubage.scope = 'box'
    const read = readSettings(s)
    assert.ok('settings' in read)
    assert.equal(read.settings.modes[0].label, 'Transportadora')
    assert.equal(read.settings.modes[0].cubage.scope, 'shipment')
  })

  it('refuses anything shaped differently', () => {
    for (const value of [null, [], 'x', { boxes: [] }, { ...sent(), modes: 'x' }]) {
      assert.ok('problems' in readSettings(value))
    }
  })

  it('names boxes by their trimmed capitals', () => {
    assert.equal(boxId('  cm '), 'CM')
  })
})
