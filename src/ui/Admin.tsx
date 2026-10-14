/**
 * The admin area (#admin): log in with the admin password, then correct or
 * delete saved propostas, and change the settings everyone uses.
 */

import { useEffect, useState } from 'react'

import {
  checkSession,
  correctProposal,
  deleteProposal,
  forgetToken,
  LoggedOut,
  logIn,
  saveSettings,
  savedToken,
} from '../admin/api.ts'
import { listProposals } from '../proposal/api.ts'
import type { ProposalSummary } from '../proposal/format.ts'
import { useSettings } from '../settings/context.tsx'
import { DEFAULT_SETTINGS, readSettings, type Settings } from '../settings/format.ts'
import { Field } from './controls.tsx'
import { num, parseDecimal, when } from './format.ts'

export function Admin() {
  const [token, setToken] = useState<string | null>(savedToken)
  const [tab, setTab] = useState<'proposals' | 'settings'>('proposals')
  const [notice, setNotice] = useState('')

  // A token kept from earlier may have been signed out by a new password.
  useEffect(() => {
    if (!token) return
    checkSession(token).catch((error: Error) => {
      if (error instanceof LoggedOut) {
        setToken(null)
        setNotice(error.message)
      }
    })
  }, [token])

  const loggedOut = (error: unknown) => {
    if (error instanceof LoggedOut) {
      setToken(null)
      setNotice(error.message)
      return true
    }
    return false
  }

  if (!token) {
    return (
      <Login
        notice={notice}
        onLogIn={(t) => {
          setNotice('')
          setToken(t)
        }}
      />
    )
  }

  return (
    <main className="page">
      <section className="admin">
        <header className="admin-head">
          <h2>Administração</h2>
          <button
            type="button"
            className="link"
            onClick={() => {
              forgetToken()
              setToken(null)
            }}
          >
            Sair
          </button>
        </header>
        <div className="segmented admin-tabs" role="group" aria-label="Seção">
          <button type="button" aria-pressed={tab === 'proposals'} onClick={() => setTab('proposals')}>
            Propostas
          </button>
          <button type="button" aria-pressed={tab === 'settings'} onClick={() => setTab('settings')}>
            Configurações
          </button>
        </div>
        {tab === 'proposals' ? (
          <ProposalsAdmin token={token} onLoggedOut={loggedOut} />
        ) : (
          <SettingsAdmin token={token} onLoggedOut={loggedOut} />
        )}
      </section>
    </main>
  )
}

function Login({ notice, onLogIn }: { notice: string; onLogIn: (token: string) => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLogIn(await logIn(password))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <form className="admin admin-login" onSubmit={submit}>
        <h2>Administração</h2>
        {notice && <p className="hint">{notice}</p>}
        <div className="field">
          <label htmlFor="admin-password">Senha de administrador</label>
          <div className="control">
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        {error && (
          <ul className="problems" role="alert">
            <li>{error}</li>
          </ul>
        )}
        <button type="submit" className="save-button" disabled={busy || !password}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}

// Propostas

function ProposalsAdmin({ token, onLoggedOut }: { token: string; onLoggedOut: (e: unknown) => boolean }) {
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<ProposalSummary[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ id: number; number: string; responsible: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    const timer = setTimeout(
      () =>
        listProposals(search.trim()).then(
          (found) => current && setRows(found),
          (e: Error) => current && setError(e.message),
        ),
      search ? 300 : 0,
    )
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [search])

  const saveCorrection = async () => {
    if (!editing) return
    setBusy(true)
    setError('')
    try {
      await correctProposal(token, editing.id, { number: editing.number, responsible: editing.responsible })
      setRows((all) =>
        all?.map((r) =>
          r.id === editing.id ? { ...r, number: editing.number.trim(), responsible: editing.responsible.trim() } : r,
        ) ?? null,
      )
      setEditing(null)
    } catch (e) {
      if (!onLoggedOut(e)) setError((e as Error).message)
    }
    setBusy(false)
  }

  const remove = async (row: ProposalSummary) => {
    if (!window.confirm(`Excluir a proposta ${row.number} para sempre? Não dá para desfazer.`)) return
    setBusy(true)
    setError('')
    try {
      await deleteProposal(token, row.id)
      setRows((all) => all?.filter((r) => r.id !== row.id) ?? null)
    } catch (e) {
      if (!onLoggedOut(e)) setError((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="admin-section">
      <Field
        label="Buscar"
        inputMode="text"
        placeholder="Número, responsável ou produto"
        value={search}
        onChange={setSearch}
      />
      {error && (
        <ul className="problems" role="alert">
          <li>{error}</li>
        </ul>
      )}
      {rows === null && !error && <p className="hint">Carregando…</p>}
      {rows?.length === 0 && <p className="empty">Nenhuma proposta encontrada.</p>}
      <ul className="proposals admin-proposals">
        {rows?.map((row) =>
          editing?.id === row.id ? (
            <li key={row.id} className="admin-editing">
              <div className="proposal-fields">
                <Field
                  label="Nº da proposta"
                  inputMode="text"
                  value={editing.number}
                  onChange={(number) => setEditing({ ...editing, number })}
                />
                <Field
                  label="Responsável"
                  inputMode="text"
                  value={editing.responsible}
                  onChange={(responsible) => setEditing({ ...editing, responsible })}
                />
              </div>
              <div className="admin-actions">
                <button type="button" className="save-button" onClick={saveCorrection} disabled={busy}>
                  Salvar correção
                </button>
                <button type="button" className="link" onClick={() => setEditing(null)}>
                  Cancelar
                </button>
              </div>
            </li>
          ) : (
            <li key={row.id}>
              <a href={`#proposta/${row.id}`}>
                <span className="proposal-number">{row.number}</span>
                <span className="proposal-headline">{row.headline}</span>
                <small>
                  {row.products} · {row.responsible} · {when(row.savedAt)}
                </small>
              </a>
              <div className="admin-actions">
                <button
                  type="button"
                  className="link"
                  disabled={busy}
                  onClick={() => setEditing({ id: row.id, number: row.number, responsible: row.responsible })}
                >
                  Corrigir
                </button>
                <button type="button" className="link danger" disabled={busy} onClick={() => remove(row)}>
                  Excluir
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
      <p className="hint">
        Corrigir muda só o número e o responsável; os produtos e o resultado de uma proposta salva não
        mudam. Excluir apaga a proposta para sempre e libera o número dela.
      </p>
    </div>
  )
}

// Settings, edited as text so that commas and half-typed numbers are fine.

interface BoxForm {
  key: number
  name: string
  length: string
  width: string
  height: string
  empty: string
  max: string
  cost: string
}

interface ModeForm {
  id: string
  label: string
  maxKg: string
  side: string
  sum: string
  cubage: string
  ignore: string
}

interface CarrierForm {
  key: number
  name: string
  tracking: boolean
}

interface Form {
  boxes: BoxForm[]
  modes: ModeForm[]
  loss: string
  penalty: string
  fragile: string
  carriers: CarrierForm[]
  factor: string
}

const optional = (n: number | undefined) => (n === undefined ? '' : num(n, 3))

function toForm(s: Settings): Form {
  return {
    boxes: s.boxes.map((b, i) => ({
      key: i,
      name: b.name,
      length: num(b.dims.length, 2),
      width: num(b.dims.width, 2),
      height: num(b.dims.height, 2),
      empty: num(b.emptyWeightKg, 3),
      max: optional(b.maxWeightKg),
      cost: optional(b.costBRL),
    })),
    modes: s.modes.map((m) => ({
      id: m.id,
      label: m.label,
      maxKg: num(m.maxGrossKg, 2),
      side: num(m.maxSideCm, 1),
      sum: num(m.maxSumCm, 1),
      cubage: num(m.cubage.kgPerM3, 3),
      ignore: num(m.cubage.ignoreUpToKg, 2),
    })),
    loss: num(s.lossCm, 2),
    penalty: num(s.boxPenaltyLiters, 1),
    fragile: num(s.fragileLoad, 2),
    carriers: s.carriers.map((c, i) => ({ key: i, ...c })),
    factor: num(s.chargeFactor, 2),
  }
}

/** The form as settings; numbers that do not read stay NaN for readSettings to name. */
function fromForm(f: Form): unknown {
  const n = (text: string) => parseDecimal(text)
  const maybe = (text: string) => (text.trim() === '' ? undefined : n(text))
  return {
    boxes: f.boxes.map((b) => ({
      id: '',
      name: b.name,
      dims: { length: n(b.length), width: n(b.width), height: n(b.height) },
      emptyWeightKg: n(b.empty),
      maxWeightKg: maybe(b.max),
      costBRL: maybe(b.cost),
    })),
    modes: f.modes.map((m) => ({
      id: m.id,
      maxGrossKg: n(m.maxKg),
      maxSideCm: n(m.side),
      maxSumCm: n(m.sum),
      cubage: { kgPerM3: n(m.cubage), ignoreUpToKg: n(m.ignore) },
    })),
    lossCm: n(f.loss),
    boxPenaltyLiters: n(f.penalty),
    fragileLoad: n(f.fragile),
    carriers: f.carriers.map(({ name, tracking }) => ({ name, tracking })),
    chargeFactor: n(f.factor),
  }
}

function SettingsAdmin({ token, onLoggedOut }: { token: string; onLoggedOut: (e: unknown) => boolean }) {
  const { settings, savedAt, update } = useSettings()
  const [form, setForm] = useState(() => toForm(settings))
  const [problems, setProblems] = useState<string[]>([])
  const [done, setDone] = useState('')
  const [busy, setBusy] = useState(false)

  const change = (next: Partial<Form>) => {
    setForm({ ...form, ...next })
    setDone('')
  }
  const changeBox = (key: number, next: Partial<BoxForm>) =>
    change({ boxes: form.boxes.map((b) => (b.key === key ? { ...b, ...next } : b)) })
  const changeMode = (id: string, next: Partial<ModeForm>) =>
    change({ modes: form.modes.map((m) => (m.id === id ? { ...m, ...next } : m)) })
  const changeCarrier = (key: number, next: Partial<CarrierForm>) =>
    change({ carriers: form.carriers.map((c) => (c.key === key ? { ...c, ...next } : c)) })

  const save = async () => {
    const read = readSettings(fromForm(form))
    if ('problems' in read) {
      setProblems(read.problems)
      return
    }
    if (!window.confirm('Salvar estas configurações? Elas passam a valer para todos que abrirem a página.')) return
    setBusy(true)
    setProblems([])
    try {
      const saved = await saveSettings(token, read.settings)
      update(saved.settings, saved.savedAt)
      setForm(toForm(saved.settings))
      setDone('Configurações salvas. Valem para todos a partir de agora.')
    } catch (e) {
      if (!onLoggedOut(e)) setProblems([(e as Error).message])
    }
    setBusy(false)
  }

  return (
    <div className="admin-section">
      <p className="hint">
        {savedAt ? `Em uso desde ${when(savedAt)}.` : 'Em uso: os valores de fábrica.'} Cada vez que você
        salva, a versão anterior fica guardada no banco de dados.
      </p>

      <h3>Caixas</h3>
      <div className="admin-boxes">
        {form.boxes.map((b) => (
          <div className="admin-box" key={b.key} role="group" aria-label={b.name || 'Caixa nova'}>
            <Field label="Nome" inputMode="text" value={b.name} onChange={(name) => changeBox(b.key, { name })} />
            <Field label="C" suffix="cm" value={b.length} onChange={(length) => changeBox(b.key, { length })} />
            <Field label="L" suffix="cm" value={b.width} onChange={(width) => changeBox(b.key, { width })} />
            <Field label="A" suffix="cm" value={b.height} onChange={(height) => changeBox(b.key, { height })} />
            <Field label="Peso vazia" suffix="kg" value={b.empty} onChange={(empty) => changeBox(b.key, { empty })} />
            <Field
              label="Peso máx."
              suffix="kg"
              placeholder="—"
              value={b.max}
              onChange={(max) => changeBox(b.key, { max })}
            />
            <Field
              label="Custo"
              suffix="R$"
              placeholder="—"
              value={b.cost}
              onChange={(cost) => changeBox(b.key, { cost })}
            />
            <button
              type="button"
              className="remove"
              aria-label={b.name ? `Remover a caixa ${b.name}` : 'Remover a caixa nova'}
              onClick={() => change({ boxes: form.boxes.filter((x) => x.key !== b.key) })}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="add"
        onClick={() =>
          change({
            boxes: [
              ...form.boxes,
              {
                key: Math.max(0, ...form.boxes.map((b) => b.key)) + 1,
                name: '',
                length: '',
                width: '',
                height: '',
                empty: '',
                max: '',
                cost: '',
              },
            ],
          })
        }
      >
        + Adicionar caixa
      </button>
      <p className="hint">
        Medidas internas. Peso máx. é um limite da própria caixa, além do limite do envio. Com o custo
        preenchido em todas as caixas, a página passa a oferecer o critério de menor custo.
      </p>

      <h3>Envio</h3>
      {form.modes.map((m) => (
        <fieldset className="admin-mode" key={m.id}>
          <legend>{m.label}</legend>
          <div className="admin-row">
            <Field label="Limite por caixa" suffix="kg" value={m.maxKg} onChange={(maxKg) => changeMode(m.id, { maxKg })} />
            <Field label="Maior lado" suffix="cm" value={m.side} onChange={(side) => changeMode(m.id, { side })} />
            <Field label="Soma C + L + A" suffix="cm" value={m.sum} onChange={(sum) => changeMode(m.id, { sum })} />
            <Field
              label="Fator de cubagem"
              suffix="kg/m³"
              value={m.cubage}
              onChange={(cubage) => changeMode(m.id, { cubage })}
            />
            <Field
              label="Ignora cubagem até"
              suffix="kg"
              value={m.ignore}
              onChange={(ignore) => changeMode(m.id, { ignore })}
            />
          </div>
        </fieldset>
      ))}
      <p className="hint">
        Zero em maior lado ou soma: sem limite. O fator dos Correios é 166,667 kg/m³ (C × L × A ÷ 6000).
      </p>

      <h3>Frete</h3>
      <div className="admin-carriers">
        {form.carriers.map((c) => (
          <div className="admin-carrier" key={c.key} role="group" aria-label={c.name || 'Transportadora nova'}>
            <Field
              label="Transportadora"
              inputMode="text"
              value={c.name}
              onChange={(name) => changeCarrier(c.key, { name })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={c.tracking}
                onChange={(e) => changeCarrier(c.key, { tracking: e.target.checked })}
              />
              <span>Tem código de rastreio</span>
            </label>
            <button
              type="button"
              className="remove"
              aria-label={c.name ? `Remover ${c.name}` : 'Remover a transportadora nova'}
              onClick={() => change({ carriers: form.carriers.filter((x) => x.key !== c.key) })}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="add"
        onClick={() =>
          change({
            carriers: [
              ...form.carriers,
              { key: Math.max(0, ...form.carriers.map((c) => c.key)) + 1, name: '', tracking: false },
            ],
          })
        }
      >
        + Adicionar transportadora
      </button>
      <div className="admin-row admin-row-wide">
        <Field
          label="Valor ideal de cobrança"
          suffix="× o valor"
          value={form.factor}
          onChange={(factor) => change({ factor })}
          hint="Quantas vezes o valor da transportadora o cliente deveria pagar de frete."
        />
      </div>
      <p className="hint">
        As transportadoras aparecem na seção Frete de cada proposta. Com código de rastreio, a proposta
        mostra o rastreio como pendente até ele ser preenchido. Tirar uma transportadora da lista não
        muda as propostas que já a usam.
      </p>

      <h3>Outros valores</h3>
      <div className="admin-row admin-row-wide">
        <Field
          label="Folga interna padrão"
          suffix="cm"
          value={form.loss}
          onChange={(loss) => change({ loss })}
          hint="Com que folga uma proposta nova começa."
        />
        <Field
          label="Peso sobre um frágil"
          suffix="× o peso"
          value={form.fragile}
          onChange={(fragile) => change({ fragile })}
          hint="Sem Máx. camadas: quanto de outros produtos pode ir sobre cada unidade."
        />
        <Field
          label="Uma caixa a mais vale"
          suffix="litros"
          value={form.penalty}
          onChange={(penalty) => change({ penalty })}
          hint="Só para o critério de equilíbrio entre caixas e volume."
        />
      </div>

      {problems.length > 0 && (
        <ul className="problems" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {done && <p className="save-status">{done}</p>}
      <div className="admin-actions">
        <button type="button" className="save-button" onClick={save} disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar para todos'}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            change(toForm(DEFAULT_SETTINGS))
            setProblems([])
          }}
        >
          Voltar aos valores de fábrica
        </button>
      </div>
      <p className="hint">“Voltar aos valores de fábrica” só preenche o formulário; nada muda até você salvar.</p>
    </div>
  )
}
