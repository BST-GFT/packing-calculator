import { useEffect, useState, type ReactNode } from 'react'

import logoUrl from './assets/logo.jpg'
import { loadProposal } from './proposal/api.ts'
import type { Proposal } from './proposal/format.ts'
import { SettingsProvider, useSettings } from './settings/context.tsx'
import { Admin } from './ui/Admin.tsx'
import { Calculator } from './ui/Calculator.tsx'
import { ProposalList } from './ui/ProposalList.tsx'

/** "0.9" for version 0.9.0, "0.9.1" for 0.9.1. */
const VERSION = __APP_VERSION__.replace(/\.0$/, '')

/**
 * Which screen the address shows. The part after # keeps the page a single
 * file while giving each screen, and each saved proposta, its own address:
 *   (nothing)       the start: new proposta or load one
 *   #nova           a new proposta
 *   #carregar       the list of saved propostas
 *   #proposta/12    saved proposta 12
 *   #admin          the admin area, behind the admin password
 */
type Screen =
  | { name: 'start' }
  | { name: 'new' }
  | { name: 'list' }
  | { name: 'proposal'; id: number }
  | { name: 'admin' }

function screenOf(hash: string): Screen {
  if (hash === '#nova') return { name: 'new' }
  if (hash === '#carregar') return { name: 'list' }
  if (hash === '#admin') return { name: 'admin' }
  const proposal = /^#proposta\/(\d+)$/.exec(hash)
  if (proposal) return { name: 'proposal', id: Number(proposal[1]) }
  return { name: 'start' }
}

export function App() {
  const [screen, setScreen] = useState(() => screenOf(location.hash))
  // Each visit to "Nova proposta" starts from an empty page.
  const [fresh, setFresh] = useState(0)

  useEffect(() => {
    const follow = () => {
      const next = screenOf(location.hash)
      if (next.name === 'new') setFresh((n) => n + 1)
      setScreen(next)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])

  return (
    <SettingsProvider>
      <header className="top">
        <a className="home" href="#" aria-label="Início">
          <img className="logo" src={logoUrl} alt="Best Shipping" width={638} height={144} />
        </a>
        <h1>Calculadora de embalagem</h1>
        {screen.name !== 'start' && (
          <nav className="top-nav">
            <a href="#nova">Nova proposta</a>
            <a href="#carregar">Carregar proposta</a>
          </nav>
        )}
      </header>

      {screen.name === 'start' && <Start />}
      {screen.name === 'new' && (
        <WithSettings>
          <Calculator key={`new-${fresh}`} loaded={null} />
        </WithSettings>
      )}
      {screen.name === 'list' && <ProposalList />}
      {screen.name === 'proposal' && (
        <WithSettings>
          <Saved key={screen.id} id={screen.id} />
        </WithSettings>
      )}
      {screen.name === 'admin' && (
        <WithSettings>
          <Admin />
        </WithSettings>
      )}
      <p className="version">v{VERSION}</p>
    </SettingsProvider>
  )
}

/** The calculator and the admin's form start from the shared settings, so they wait for them. */
function WithSettings({ children }: { children: ReactNode }) {
  if (useSettings().status === 'loading') {
    return (
      <main className="page">
        <p className="empty">Carregando…</p>
      </main>
    )
  }
  return children
}

function Start() {
  return (
    <main className="start">
      <a className="start-choice start-new" href="#nova">
        <strong>Nova proposta</strong>
        <span>Calcular as caixas de um pedido novo.</span>
      </a>
      <a className="start-choice" href="#carregar">
        <strong>Carregar proposta</strong>
        <span>Abrir uma proposta salva, para consultar ou usar como base de uma nova.</span>
      </a>
      <a className="start-admin" href="#admin">
        Administração
      </a>
    </main>
  )
}

/** A saved proposta, fetched and opened in the calculator. */
function Saved({ id }: { id: number }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'ready'; proposal: Proposal } | { status: 'failed'; message: string }
  >({ status: 'loading' })

  useEffect(() => {
    let current = true
    loadProposal(id).then(
      (proposal) => current && setState({ status: 'ready', proposal }),
      (error: Error) => current && setState({ status: 'failed', message: error.message }),
    )
    return () => {
      current = false
    }
  }, [id])

  if (state.status === 'ready') return <Calculator loaded={state.proposal} />
  return (
    <main className="page">
      <p className={state.status === 'failed' ? 'empty problem' : 'empty'}>
        {state.status === 'failed' ? state.message : 'Abrindo a proposta…'}
      </p>
      {state.status === 'failed' && (
        <p className="hint">
          <a href="#carregar">Voltar à lista de propostas</a>
        </p>
      )}
    </main>
  )
}
