/** The page's side of saving and loading propostas, through the server's /api/. */

import type { Proposal, ProposalDraft, ProposalSummary } from './format.ts'
import type { Freight, FreightDraft } from './freight.ts'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    // A form (with a file) sets its own type.
    const json = typeof init?.body === 'string'
    response = await fetch(path, {
      ...init,
      headers: json ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
    })
  } catch {
    throw new Error('Sem conexão com o servidor. Confira a internet e tente de novo.')
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? String(body.error) : ''
    throw new Error(error || `O servidor respondeu com erro (${response.status}).`)
  }
  return body as T
}

export const saveProposal = (draft: ProposalDraft) =>
  call<{ proposal: { id: number; savedAt: string } }>('/api/proposals', {
    method: 'POST',
    body: JSON.stringify(draft),
  }).then((r) => r.proposal)

export const listProposals = (search: string) =>
  call<{ proposals: ProposalSummary[] }>(
    `/api/proposals?q=${encodeURIComponent(search)}`,
  ).then((r) => r.proposals)

export const loadProposal = (id: number) =>
  call<{ proposal: Proposal }>(`/api/proposals/${id}`).then((r) => r.proposal)

/**
 * Saves a new version of a proposta's freight, with a new quote file, or the
 * key of an earlier version's file to keep.
 */
export function saveFreight(id: number, freight: FreightDraft, file: File | null, keep: string | null) {
  const form = new FormData()
  form.set('freight', JSON.stringify(freight))
  if (file) form.set('file', file)
  else if (keep) form.set('keep', keep)
  return call<{ freight: Freight }>(`/api/proposals/${id}/freight`, { method: 'POST', body: form }).then(
    (r) => r.freight,
  )
}
