/**
 * The server: answers /api/ requests. Every other address is the page itself,
 * served by Cloudflare from the static build.
 *
 *   GET    /api/proposals?q=...         the latest propostas, optionally searched
 *   GET    /api/proposals/:id           one proposta, in full
 *   POST   /api/proposals               save a new proposta
 *   POST   /api/proposals/:id/freight   save a new version of a proposta's freight
 *   GET    /api/files/:key              a file attached to freight
 *   GET    /api/settings                the settings in use
 *
 *   POST   /api/admin/login             the admin password, for a token
 *   GET    /api/admin/session           whether a token is still good
 *   PATCH  /api/admin/proposals/:id     correct a proposta's number or responsible
 *   DELETE /api/admin/proposals/:id     delete a proposta for good
 *   PUT    /api/admin/settings          save new settings for everyone
 *
 * Only the admin routes, with a token, change a proposta (its number and
 * responsible; the database refuses any other change) or delete one. Its
 * freight is apart: anyone with the link adds versions, none ever changes.
 */

import {
  FILE_TYPES,
  MAX_FILE_BYTES,
  readFreight,
  type Freight,
  type FreightFile,
} from '../src/proposal/freight.ts'
import { FORMAT, LIMITS, numberKey, readDraft, type ProposalSummary } from '../src/proposal/format.ts'
import { DEFAULT_SETTINGS, readSettings, type Settings } from '../src/settings/format.ts'
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
  const freight = /^\/api\/proposals\/(\d+)\/freight$/.exec(path)
  if (freight) {
    if (method === 'POST') return saveFreight(request, env, Number(freight[1]))
    return notAllowed('POST')
  }
  const file = /^\/api\/files\/(\d+\/[0-9a-f-]{36})$/.exec(path)
  if (file) {
    if (method === 'GET') return getFile(env, file[1])
    return notAllowed('GET')
  }
  if (path === '/api/settings') {
    if (method === 'GET') return reply(await currentSettings(env))
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
  // With the carrier of each one's latest freight, which can be searched too.
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.number, p.responsible, p.products, p.headline, p.saved_at AS savedAt,
            f.carrier, f.tracking_needed = 1 AND f.tracking = '' AS pending
       FROM proposals p
       LEFT JOIN freight f ON f.id = (SELECT MAX(id) FROM freight WHERE proposal_id = p.id)
      WHERE ?1 = ''
         OR p.number LIKE ?2 ESCAPE '\\'
         OR p.responsible LIKE ?2 ESCAPE '\\'
         OR p.products LIKE ?2 ESCAPE '\\'
         OR f.carrier LIKE ?2 ESCAPE '\\'
      ORDER BY p.id DESC
      LIMIT ?3`,
  )
    .bind(search, pattern, PAGE)
    .all<Omit<ProposalSummary, 'trackingPending'> & { pending: number | null }>()
  const proposals: ProposalSummary[] = results.map(({ pending, ...p }) => ({ ...p, trackingPending: pending === 1 }))
  return reply({ proposals })
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
  const { results } = await env.DB.prepare(
    'SELECT * FROM freight WHERE proposal_id = ? ORDER BY id DESC LIMIT 100',
  )
    .bind(id)
    .all<FreightRow>()
  const history = results.map(toFreight)
  return reply({
    proposal: {
      ...row,
      input: JSON.parse(row.input),
      result: JSON.parse(row.result),
      freight: history[0] ?? null,
      freightHistory: history,
    },
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
  // Its freight and the files attached to it go too.
  const { results: files } = await env.DB.prepare(
    'SELECT DISTINCT file_key AS key FROM freight WHERE proposal_id = ? AND file_key IS NOT NULL',
  )
    .bind(id)
    .all<{ key: string }>()
  const [, done] = await env.DB.batch([
    env.DB.prepare('DELETE FROM freight WHERE proposal_id = ?').bind(id),
    env.DB.prepare('DELETE FROM proposals WHERE id = ?').bind(id),
  ])
  if (done.meta.changes === 0) return reply({ error: 'Proposta não encontrada.' }, 404)
  if (files.length > 0) await env.FILES.delete(files.map((f) => f.key))
  return reply({ deleted: true })
}

// Freight

interface FreightRow {
  id: number
  carrier: string
  tracking_needed: number
  quoted_brl: number
  factor: number
  charged_brl: number
  quote_date: string
  tracking: string
  file_key: string | null
  file_name: string | null
  file_type: string | null
  file_size: number | null
  saved_at: string
}

const toFreight = (r: FreightRow): Freight => ({
  id: r.id,
  carrier: r.carrier,
  trackingNeeded: r.tracking_needed === 1,
  quotedBRL: r.quoted_brl,
  factor: r.factor,
  chargedBRL: r.charged_brl,
  quoteDate: r.quote_date,
  tracking: r.tracking,
  file: r.file_key
    ? { key: r.file_key, name: r.file_name ?? '', type: r.file_type ?? '', size: r.file_size ?? 0 }
    : null,
  savedAt: r.saved_at,
})

/**
 * A new version of a proposta's freight, sent as a form: `freight` holds the
 * values as JSON, `file` a new quote file, or `keep` the key of the file of
 * an earlier version to keep.
 */
async function saveFreight(request: Request, env: Env, id: number): Promise<Response> {
  const exists = await env.DB.prepare('SELECT 1 FROM proposals WHERE id = ?').bind(id).first()
  if (!exists) return reply({ error: 'Proposta não encontrada.' }, 404)

  const broken = reply({ error: 'O pedido veio com defeito.' }, 400)
  let form: FormData
  let value: unknown
  try {
    form = await request.formData()
    value = JSON.parse(String(form.get('freight')))
  } catch {
    return broken
  }
  const latest = await env.DB.prepare('SELECT * FROM freight WHERE proposal_id = ? ORDER BY id DESC LIMIT 1')
    .bind(id)
    .first<FreightRow>()
  const { settings } = await currentSettings(env)
  const read = readFreight(value, settings.carriers, latest && toFreight(latest))
  if ('problems' in read) return reply({ error: read.problems.join(' '), problems: read.problems }, 400)

  // The quote's file: a new one, one kept from an earlier version, or none.
  let file: FreightFile | null = null
  const upload = form.get('file')
  const keep = form.get('keep')
  if (upload instanceof File) {
    if (!FILE_TYPES.includes(upload.type)) {
      return reply({ error: 'Anexe uma imagem (JPG, PNG ou WebP) ou um PDF.' }, 400)
    }
    if (upload.size > MAX_FILE_BYTES) return reply({ error: 'O anexo pode ter até 10 MB.' }, 413)
    file = {
      key: `${id}/${crypto.randomUUID()}`,
      name: upload.name.slice(0, 120) || 'cotacao',
      type: upload.type,
      size: upload.size,
    }
    await env.FILES.put(file.key, upload, { httpMetadata: { contentType: upload.type } })
  } else if (typeof keep === 'string' && keep) {
    const earlier = await env.DB.prepare(
      'SELECT * FROM freight WHERE proposal_id = ? AND file_key = ? LIMIT 1',
    )
      .bind(id, keep)
      .first<FreightRow>()
    if (!earlier) return reply({ error: 'O anexo anterior não foi encontrado. Anexe o arquivo de novo.' }, 400)
    file = toFreight(earlier).file
  }

  const f = read.freight
  try {
    const row = await env.DB.prepare(
      `INSERT INTO freight (proposal_id, carrier, tracking_needed, quoted_brl, factor, charged_brl,
                            quote_date, tracking, file_key, file_name, file_type, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
      .bind(
        id,
        f.carrier,
        f.trackingNeeded ? 1 : 0,
        f.quotedBRL,
        settings.chargeFactor,
        f.chargedBRL,
        f.quoteDate,
        f.tracking,
        file?.key ?? null,
        file?.name ?? null,
        file?.type ?? null,
        file?.size ?? null,
      )
      .first<FreightRow>()
    return reply({ freight: toFreight(row!) }, 201)
  } catch (error) {
    // A file nobody points to would only take space.
    if (upload instanceof File && file) await env.FILES.delete(file.key)
    throw error
  }
}

/** A file attached to freight, while some version of that freight still points to it. */
async function getFile(env: Env, key: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT * FROM freight WHERE file_key = ? LIMIT 1')
    .bind(key)
    .first<FreightRow>()
  const object = row ? await env.FILES.get(key) : null
  if (!row || !object) return reply({ error: 'Anexo não encontrado.' }, 404)
  return new Response(object.body, {
    headers: {
      // Only the types accepted on upload, never guessed by the browser.
      'Content-Type': row.file_type ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name ?? 'cotacao')}`,
      'Cache-Control': 'private, no-cache',
    },
  })
}

// Settings

/** The settings saved last, or the factory ones until the admin first saves. */
async function currentSettings(env: Env): Promise<{ settings: Settings; savedAt: string | null }> {
  const row = await env.DB.prepare('SELECT value, saved_at AS savedAt FROM settings ORDER BY id DESC LIMIT 1')
    .first<{ value: string; savedAt: string }>()
  if (row) {
    const read = readSettings(JSON.parse(row.value))
    if ('settings' in read) return { settings: read.settings, savedAt: row.savedAt }
    console.error('Saved settings no longer pass the checks; using the factory defaults.', read.problems)
  }
  return { settings: DEFAULT_SETTINGS, savedAt: null }
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
