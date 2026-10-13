import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { adminPassword, issueToken, sameText, validToken } from './admin.ts'

describe('the admin login', () => {
  it('compares texts exactly', async () => {
    assert.ok(await sameText('correto', 'correto'))
    assert.ok(!(await sameText('correto', 'Correto')))
    assert.ok(!(await sameText('correto', 'correto ')))
    assert.ok(!(await sameText('', 'x')))
  })

  it('accepts a token only with the password it was issued with', async () => {
    const { token, expiresAt } = await issueToken('senha-de-teste')
    assert.ok(new Date(expiresAt).getTime() > Date.now())
    assert.ok(await validToken(token, 'senha-de-teste'))
    assert.ok(!(await validToken(token, 'outra-senha')))
  })

  it('refuses tokens that were changed or ran out', async () => {
    const { token } = await issueToken('senha-de-teste')
    const [expires, signature] = token.split('.')
    const later = `${Number(expires) + 3_600_000}.${signature}`
    assert.ok(!(await validToken(later, 'senha-de-teste')), 'a longer life invalidates the signature')
    assert.ok(!(await validToken(`${Date.now() - 1}.${signature}`, 'senha-de-teste')), 'expired')
    for (const broken of ['', 'abc', '123.', '.abc', 'x.y.z']) {
      assert.ok(!(await validToken(broken, 'senha-de-teste')), broken)
    }
  })

  it('treats an unset or empty password as not configured', () => {
    assert.equal(adminPassword({}), undefined)
    assert.equal(adminPassword({ ADMIN_PASSWORD: '' }), undefined)
    assert.equal(adminPassword({ ADMIN_PASSWORD: 'x' }), 'x')
  })
})
