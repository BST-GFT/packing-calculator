/** The saved propostas, newest first, with a search. */

import { useEffect, useState } from 'react'

import { listProposals } from '../proposal/api.ts'
import type { ProposalSummary } from '../proposal/format.ts'
import { Field } from './controls.tsx'
import { when } from './format.ts'

type State =
  | { status: 'loading'; rows: ProposalSummary[] }
  | { status: 'ready'; rows: ProposalSummary[] }
  | { status: 'failed'; message: string }

export function ProposalList() {
  const [search, setSearch] = useState('')
  const [state, setState] = useState<State>({ status: 'loading', rows: [] })

  useEffect(() => {
    let current = true
    // Wait for a pause in typing before searching.
    const timer = setTimeout(
      () =>
        listProposals(search.trim()).then(
          (rows) => current && setState({ status: 'ready', rows }),
          (error: Error) => current && setState({ status: 'failed', message: error.message }),
        ),
      search ? 300 : 0,
    )
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [search])

  const rows = state.status === 'failed' ? [] : state.rows
  return (
    <main className="page">
      <section className="proposal-list">
        <h2>Carregar proposta</h2>
        <Field
          label="Buscar"
          inputMode="text"
          placeholder="Número, responsável ou produto"
          value={search}
          onChange={(value) => {
            setSearch(value)
            setState((s) => (s.status === 'failed' ? { status: 'loading', rows: [] } : { ...s, status: 'loading' }))
          }}
        />
        {state.status === 'failed' && (
          <ul className="problems" role="alert">
            <li>{state.message}</li>
          </ul>
        )}
        {state.status === 'ready' && rows.length === 0 && (
          <p className="empty">
            {search.trim() ? 'Nenhuma proposta encontrada.' : 'Nenhuma proposta salva ainda.'}
          </p>
        )}
        {state.status === 'loading' && rows.length === 0 && <p className="hint">Carregando…</p>}
        <ul className="proposals" aria-busy={state.status === 'loading'}>
          {rows.map((p) => (
            <li key={p.id}>
              <a href={`#proposta/${p.id}`}>
                <span className="proposal-number">{p.number}</span>
                <span className="proposal-headline">{p.headline}</span>
                <small>
                  {p.products} · {p.responsible} · {when(p.savedAt)}
                </small>
              </a>
            </li>
          ))}
        </ul>
        <p className="hint">
          Mostra as 50 mais recentes; busque para encontrar as mais antigas. Propostas salvas não podem
          ser alteradas: ao abrir uma, salve as mudanças com um número novo.
        </p>
      </section>
    </main>
  )
}
