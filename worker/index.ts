/**
 * The server: answers /api/ requests about saved propostas. Every other
 * address is the page itself, served by Cloudflare from the static build.
 *
 *   GET  /api/proposals?q=...   the latest propostas, optionally searched
 *   GET  /api/proposals/:id     one proposta, in full
 *   POST /api/proposals         save a new proposta
 *
 * There is no way to change or delete a proposta here: saved propostas stay
 * as they were, and the database refuses changes as well.
 */

import { FORMAT, numberKey, readDraft, type ProposalSummary } from '../src/proposal/format.ts'

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
  if (path === '/api/proposals') {
    if (request.method === 'GET') return list(env, url)
    if (request.method === 'POST') return create(request, env)
    return reply({ error: 'Pedido não aceito.' }, 405, { Allow: 'GET, POST' })
  }
  const one = /^\/api\/proposals\/(\d+)$/.exec(path)
  if (one) {
    if (request.method === 'GET') return get(env, Number(one[1]))
    return reply({ error: 'Propostas salvas não podem ser alteradas.' }, 405, { Allow: 'GET' })
  }
  return reply({ error: 'Endereço não encontrado.' }, 404)
}

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
    `SELECT id, number, responsible, input, result, saved_at AS savedAt FROM proposals WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: number; number: string; responsible: string; input: string; result: string; savedAt: string }>()
  if (!row) return reply({ error: 'Proposta não encontrada.' }, 404)
  return reply({
    proposal: { ...row, input: JSON.parse(row.input), result: JSON.parse(row.result) },
  })
}

async function create(request: Request, env: Env): Promise<Response> {
  const text = await request.text()
  if (text.length > MAX_BODY) return reply({ error: 'A proposta é grande demais para salvar.' }, 413)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return reply({ error: 'O pedido para salvar a proposta veio com defeito.' }, 400)
  }
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
    if (String(error).includes('UNIQUE')) {
      return reply(
        { error: `Já existe uma proposta com o número ${number.trim()}. Para salvar, use outro número.` },
        409,
      )
    }
    throw error
  }
}

function reply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}
