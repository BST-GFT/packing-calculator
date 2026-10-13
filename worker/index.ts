/**
 * The server: answers /api/ requests. Every other address is the page itself,
 * served by Cloudflare from the static build.
 *
 *   GET    /api/proposals?q=...         the latest propostas, optionally searched
 *   GET    /api/proposals/:id           one proposta, in full
 *   POST   /api/proposals               save a new proposta
 *   GET    /api/settings                the settings in use
 *
 *   POST   /api/admin/login             the admin password, for a token
 *   GET    /api/admin/session           whether a token is still good
 *   PATCH  /api/admin/proposals/:id     correct a proposta's number or responsible
 *   DELETE /api/admin/proposals/:id     delete a proposta for good
 *   PUT    /api/admin/settings          save new settings for everyone
 *
 * Only the admin routes, with a token, change a proposta (its number and
 * responsible; the database refuses any other change) or delete one.
 */

import { FORMAT, LIMITS, numberKey, readDraft, type ProposalSummary } from '../src/proposal/format.ts'
import { DEFAULT_SETTINGS, readSettings } from '../src/settings/format.ts'
import { adminPassword, issueToken, sameText, validToken } from './admin.ts'

/** Most propostas listed at once. */
const PAGE = 50
/** Largest request accepted, in characters; a proposta with 50 products is well under. */
const MAX_BODY = 200_000

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      return await route(request, env, url)
    } catch (error) {
      console.error(error)
      return reply({ error: 'Erro no servidor. Tente de novo em instantes.' }, 500)
    }
  },
} satisfies ExportedHandler<Env>

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '')
  const method = request.method

  if (path === '/api/proposals') {
    if (method === 'GET') return list(env, url)
    if (method === 'POST') return create(request, env)
    return notAllowed('GET, POST')
  }
  const one = /^\/api\/proposals\/(\d+)$/.exec(path)
  if (one) {
    if (method === 'GET') return get(env, Number(one[1]))
    return reply({ error: 'Propostas salvas não podem ser alteradas.' }, 405, { Allow: 'GET' })
  }
  if (path === '/api/settings') {
    if (method === 'GET') return settings(env)
    return notAllowed('GET')
  }

  if (path === '/api/admin/login') {
    if (method === 'POST') return login(request, env)
    return notAllowed('POST')
  }
  if (path.startsWith('/api/admin/')) {
    const refused = await checkAdmin(request, env)
    if (refused) return refused
    if (path === '/api/admin/session') return reply({ ok: true })
    const proposal = /^\/api\/admin\/proposals\/(\d+)$/.exec(path)
    if (proposal) {
      if (method === 'PATCH') return correct(request, env, Number(proposal[1]))
      if (method === 'DELETE') return remove(env, Number(proposal[1]))
      return notAllowed('PATCH, DELETE')
    }
    if (path === '/api/admin/settings') {
      if (method === 'PUT') return saveSettings(request, env)
      return notAllowed('PUT')
    }
  }
  return reply({ error: 'Endereço não encontrado.' }, 404)
}

// Propostas

async function list(env: Env, url: URL): Promise<Response> {
  const search = (url.searchParams.get('q') ?? '').trim().slice(0, 80)
  const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const { results } = await env.DB.prepare(
    `SELECT id, number, responsible, products, headline, saved_at AS savedAt
       FROM proposals
      WHERE ?1 = ''
         OR number LIKE ?2 ESCAPE '\\'
         OR responsible LIKE ?2 ESCAPE '\\'
         OR products LIKE ?2 ESCAPE '\\'
      ORDER BY id DESC
      LIMIT ?3`,
  )
    .bind(search, pattern, PAGE)
    .all<ProposalSummary>()
  return reply({ proposals: results })
}

async function get(env: Env, id: number): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, number, responsible, input, result, saved_at AS savedAt, corrected_at AS correctedAt
       FROM proposals WHERE id = ?`,
  )
    .bind(id)
    .first<{
      id: number
      number: string
      responsible: string
      input: string
      result: string
      savedAt: string
      correctedAt: string | null
    }>()
  if (!row) return reply({ error: 'Proposta não encontrada.' }, 404)
  return reply({
    proposal: { ...row, input: JSON.parse(row.input), result: JSON.parse(row.result) },
  })
}

async function create(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request)
  if (body instanceof Response) return body
  const read = readDraft(body)
  if ('problems' in read) return reply({ error: read.problems.join(' '), problems: read.problems }, 400)

  const { number, responsible, input, result } = read.draft
  try {
    const saved = await env.DB.prepare(
      `INSERT INTO proposals (number, number_key, responsible, products, headline, input, result, format)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id, saved_at AS savedAt`,
    )
      .bind(
        number.trim(),
        numberKey(number),
        responsible.trim(),
        input.products.map((p) => p.name.trim()).join(', '),
        result.headline,
        JSON.stringify(input),
        JSON.stringify(result),
        FORMAT,
      )
      .first<{ id: number; savedAt: string }>()
    return reply({ proposal: saved }, 201)
  } catch (error) {
    if (isTaken(error)) return taken(number)
    throw error
  }
}

async function correct(request: Request, env: Env, id: number): Promise<Response> {
  const body = await readBody(request)
  if (body instanceof Response) return body
  const { number, responsible } = (body ?? {}) as Record<string, unknown>
  const problems: string[] = []
  if (typeof number !== 'string' || !number.trim() || number.length > LIMITS.number) {
    problems.push('Informe o número da proposta.')
  }
  if (typeof responsible !== 'string' || !responsible.trim() || responsible.length > LIMITS.responsible) {
    problems.push('Informe o responsável pela proposta.')
  }
  if (problems.length > 0) return reply({ error: problems.join(' '), problems }, 400)
  const n = (number as string).trim()
  try {
    const done = await env.DB.prepare(
      `UPDATE proposals
          SET number = ?, number_key = ?, responsible = ?,
              corrected_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE id = ?
        RETURNING corrected_at AS correctedAt`,
    )
      .bind(n, numberKey(n), (responsible as string).trim(), id)
      .first<{ correctedAt: string }>()
    if (!done) return reply({ error: 'Proposta não encontrada.' }, 404)
    return reply({ correctedAt: done.correctedAt })
  } catch (error) {
    if (isTaken(error)) return taken(n)
    throw error
  }
}

async function remove(env: Env, id: number): Promise<Response> {
  const done = await env.DB.prepare('DELETE FROM proposals WHERE id = ?').bind(id).run()
  if (done.meta.changes === 0) return reply({ error: 'Proposta não encontrada.' }, 404)
  return reply({ deleted: true })
}

// Settings

async function settings(env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT value, saved_at AS savedAt FROM settings ORDER BY id DESC LIMIT 1')
    .first<{ value: string; savedAt: string }>()
  if (row) {
    const read = readSettings(JSON.parse(row.value))
    if ('settings' in read) return reply({ settings: read.settings, savedAt: row.savedAt })
    console.error('Saved settings no longer pass the checks; using the factory defaults.', read.problems)
  }
  return reply({ settings: DEFAULT_SETTINGS, savedAt: null })
}

async function saveSettings(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request)
  if (body instanceof Response) return body
  const read = readSettings(body)
  if ('problems' in read) return reply({ error: read.problems.join(' '), problems: read.problems }, 400)
  const saved = await env.DB.prepare('INSERT INTO settings (value) VALUES (?) RETURNING saved_at AS savedAt')
    .bind(JSON.stringify(read.settings))
    .first<{ savedAt: string }>()
  return reply({ settings: read.settings, savedAt: saved?.savedAt ?? null })
}

// Admin login

async function login(request: Request, env: Env): Promise<Response> {
  const password = adminPassword(env)
  if (!password) {
    return reply({ error: 'A senha de administrador ainda não foi configurada no Cloudflare.' }, 503)
  }
  const visitor = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const { success } = await env.LOGIN_LIMIT.limit({ key: visitor })
  if (!success) {
    return reply({ error: 'Muitas tentativas. Espere um minuto e tente de novo.' }, 429)
  }
  const body = await readBody(request)
  if (body instanceof Response) return body
  const typed = (body as Record<string, unknown> | null)?.password
  if (typeof typed !== 'string' || !(await sameText(typed, password))) {
    return reply({ error: 'Senha incorreta.' }, 401)
  }
  return reply(await issueToken(password))
}

/** Null when the request carries a good admin token; otherwise the refusal. */
async function checkAdmin(request: Request, env: Env): Promise<Response | null> {
  const password = adminPassword(env)
  const token = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '')?.[1]
  if (password && token && (await validToken(token, password))) return null
  return reply({ error: 'Entre de novo como administrador.' }, 401)
}

// Helpers

async function readBody(request: Request): Promise<unknown | Response> {
  const text = await request.text()
  if (text.length > MAX_BODY) return reply({ error: 'O pedido é grande demais.' }, 413)
  try {
    return JSON.parse(text)
  } catch {
    return reply({ error: 'O pedido veio com defeito.' }, 400)
  }
}

const isTaken = (error: unknown) => String(error).includes('UNIQUE')

const taken = (number: string) =>
  reply({ error: `Já existe uma proposta com o número ${number.trim()}. Use outro número.` }, 409)

const notAllowed = (allow: string) => reply({ error: 'Pedido não aceito.' }, 405, { Allow: allow })

function reply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}
