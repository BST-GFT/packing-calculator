/**
 * The proposta's freight ("Frete"): the carrier, its price, the ideal and the
 * actual price for the customer, the day of the quote, the tracking code once
 * the package is posted, and the carrier's quote as a file. It goes with a new
 * proposta when that is saved; for a saved one, "Atualizar frete" adds a new
 * version on its own, and the rest of the proposta never changes.
 */

import { useState, type Dispatch, type SetStateAction } from 'react'

import type { Carrier } from '../data/freight.ts'
import { saveFreight } from '../proposal/api.ts'
import {
  FILE_TYPES,
  idealCharge,
  MAX_FILE_BYTES,
  readFreight,
  type Freight,
  type FreightDraft,
  type FreightFile,
} from '../proposal/freight.ts'
import { carrierKey } from '../settings/format.ts'
import { Field } from './controls.tsx'
import { brl, day, fileSize, moneyText, num, parseMoney, today, when } from './format.ts'

/** The freight as typed. */
export interface FreightForm {
  carrier: string
  quoted: string
  charged: string
  /** YYYY-MM-DD, as a date field gives it. */
  date: string
  tracking: string
  /** A new quote file, ready to send. */
  file: File | null
  /** The file of the version in use, kept unless replaced or removed. */
  keep: FreightFile | null
}

export const blankFreight = (): FreightForm => ({
  carrier: '',
  quoted: '',
  charged: '',
  date: '',
  tracking: '',
  file: null,
  keep: null,
})

/** The form filled in from a saved version, or empty. */
export const freightForm = (f: Freight | null): FreightForm =>
  f
    ? {
        carrier: f.carrier,
        quoted: moneyText(f.quotedBRL),
        charged: moneyText(f.chargedBRL),
        date: f.quoteDate,
        tracking: f.tracking,
        file: null,
        keep: f.file,
      }
    : blankFreight()

/** Whether anything was typed or attached; the date alone is filled in for the user. */
const filled = (form: FreightForm): boolean =>
  Boolean(form.carrier || form.quoted.trim() || form.charged.trim() || form.tracking.trim() || form.file)

/**
 * The freight as it would be saved, or what is missing for that. Null when
 * nothing was filled in: freight is optional.
 */
export function checkFreight(
  form: FreightForm,
  carriers: Carrier[],
  current: Freight | null,
): { draft: FreightDraft } | { problems: string[] } | null {
  if (!filled(form)) return null
  const read = readFreight(
    {
      carrier: form.carrier,
      quotedBRL: parseMoney(form.quoted),
      chargedBRL: parseMoney(form.charged),
      quoteDate: form.date,
      tracking: form.tracking,
    },
    carriers,
    current,
  )
  return 'problems' in read ? read : { draft: read.freight }
}

/** Whether the form differs from the version in use. */
function differs(form: FreightForm, current: Freight | null): boolean {
  if (!current) return filled(form)
  return (
    form.file !== null ||
    form.keep?.key !== current.file?.key ||
    carrierKey(form.carrier) !== carrierKey(current.carrier) ||
    parseMoney(form.quoted) !== current.quotedBRL ||
    parseMoney(form.charged) !== current.chargedBRL ||
    form.date !== current.quoteDate ||
    form.tracking.trim() !== current.tracking
  )
}

/**
 * Saves the freight as a new version of proposta `id`. A file kept from
 * another proposta, as when a loaded one is saved under a new number, is
 * copied over.
 */
export async function sendFreight(id: number, form: FreightForm, draft: FreightDraft): Promise<Freight> {
  let file = form.file
  let keep = form.keep?.key ?? null
  if (form.keep && !form.keep.key.startsWith(`${id}/`)) {
    const response = await fetch(`/api/files/${form.keep.key}`).catch(() => null)
    if (!response?.ok) throw new Error('Não foi possível copiar o anexo da proposta anterior. Anexe o arquivo de novo.')
    file = new File([await response.blob()], form.keep.name, { type: form.keep.type })
    keep = null
  }
  return saveFreight(id, draft, file, keep)
}

/** Photos and screenshots are scaled down and saved as JPEG, to keep files small. */
const MAX_SIDE = 2000

async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    const image = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.width * scale)
    canvas.height = Math.round(image.height * scale)
    const context = canvas.getContext('2d')!
    // Transparent screenshots get a white background instead of black.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) return file
    if (scale === 1 && blob.size >= file.size && FILE_TYPES.includes(file.type)) return file
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' })
  } catch {
    // Not an image the browser can read; the server says whether it takes it.
    return file
  }
}

type Saving =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'refused'; problems: string[] }

export function FreightPanel({
  form,
  onChange,
  carriers,
  factor,
  current,
  history,
  saved,
  onSaved,
}: {
  form: FreightForm
  onChange: Dispatch<SetStateAction<FreightForm>>
  /** Carriers on offer, from the shared settings. */
  carriers: Carrier[]
  /** The ideal charge as a multiple of the carrier's price, from the shared settings. */
  factor: number
  /** The version in use of the saved proposta's freight, and all of them, newest first. */
  current: Freight | null
  history: Freight[]
  /** The saved proposta whose freight "Atualizar frete" updates; null before saving. */
  saved: { id: number; number: string } | null
  onSaved: (freight: Freight) => void
}) {
  const [saving, setSaving] = useState<Saving>({ state: 'idle' })
  const [fileProblem, setFileProblem] = useState('')

  const change = (next: Partial<FreightForm>) => {
    onChange((f) => ({ ...f, ...next }))
    if (saving.state !== 'saving') setSaving({ state: 'idle' })
  }

  // A carrier taken off the list since stays on offer for the freight that has it.
  const options =
    form.carrier && !carriers.some((c) => carrierKey(c.name) === carrierKey(form.carrier))
      ? [...carriers, { name: form.carrier, tracking: current?.trackingNeeded ?? false }]
      : carriers
  const carrier = options.find((c) => carrierKey(c.name) === carrierKey(form.carrier)) ?? null
  const quoted = parseMoney(form.quoted)
  const charged = parseMoney(form.charged)
  const pending = Boolean(carrier?.tracking && !form.tracking.trim())

  const pick = async (picked: File | undefined) => {
    setFileProblem('')
    if (!picked) return
    if (!picked.type.startsWith('image/') && !FILE_TYPES.includes(picked.type)) {
      setFileProblem('Anexe uma imagem (JPG, PNG ou WebP) ou um PDF.')
      return
    }
    const file = await shrink(picked)
    if (file.size > MAX_FILE_BYTES) {
      setFileProblem('O anexo pode ter até 10 MB.')
      return
    }
    change({ file })
  }

  const update = async () => {
    if (!saved) return
    const checked = checkFreight(form, carriers, current)
    if (!checked) {
      setSaving({ state: 'refused', problems: ['Escolha a transportadora.'] })
      return
    }
    if ('problems' in checked) {
      setSaving({ state: 'refused', problems: checked.problems })
      return
    }
    setSaving({ state: 'saving' })
    try {
      onSaved(await sendFreight(saved.id, form, checked.draft))
      setSaving({ state: 'saved' })
    } catch (error) {
      setSaving({ state: 'refused', problems: [(error as Error).message] })
    }
  }

  const fileLink = (f: FreightFile) => (
    <a href={`/api/files/${f.key}`} target="_blank" rel="noopener">
      {f.name}
    </a>
  )

  return (
    // Starts folded, like Envio (Francesco, 2026-10-14); the summary says what is in it.
    <details className="panel freight">
      <summary>
        Frete
        <small>
          {carrier
            ? `${carrier.name}${charged > 0 ? `, ${brl(charged)}` : ''}${pending ? ', rastreio pendente' : ''}`
            : 'não informado'}
        </small>
      </summary>

      <div className="field">
        <label htmlFor="freight-carrier">Transportadora</label>
        <div className="control">
          <select
            id="freight-carrier"
            value={carrier?.name ?? ''}
            onChange={(e) => change({ carrier: e.target.value, date: form.date || (e.target.value ? today() : '') })}
          >
            <option value="">—</option>
            {options.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {carriers.length === 0 && (
          <p className="hint">Nenhuma transportadora cadastrada; o administrador cadastra a lista.</p>
        )}
      </div>

      <Field
        label="Valor da transportadora"
        suffix="R$"
        value={form.quoted}
        onChange={(quoted) => change({ quoted })}
      />
      <p className="ideal">
        Valor ideal de cobrança: <strong>{quoted > 0 ? brl(idealCharge(quoted, factor)) : '—'}</strong>
        <small>{num(factor, 2)} × o valor da transportadora</small>
      </p>
      <Field
        label="Valor cobrado do cliente"
        suffix="R$"
        value={form.charged}
        onChange={(charged) => change({ charged })}
      />
      <div className="field">
        <label htmlFor="freight-date">Data da cotação</label>
        <div className="control">
          <input
            id="freight-date"
            type="date"
            value={form.date}
            onChange={(e) => change({ date: e.target.value })}
          />
        </div>
      </div>

      {carrier?.tracking && (
        <Field
          label="Código de rastreio"
          inputMode="text"
          value={form.tracking}
          onChange={(tracking) => change({ tracking })}
          hint={
            saved
              ? 'Quando a encomenda for postada. Até lá, fica pendente.'
              : 'Quando a encomenda for postada; pode ficar para depois de salvar a proposta.'
          }
        />
      )}

      <div className="field">
        <span className="field-label">Cotação da transportadora</span>
        {(form.file || form.keep) && (
          <p className="attachment">
            {form.file ? form.file.name : fileLink(form.keep!)}{' '}
            <small>{fileSize((form.file ?? form.keep)!.size)}</small>
            <button type="button" className="link" onClick={() => change(form.file ? { file: null } : { keep: null })}>
              Remover
            </button>
          </p>
        )}
        <label className="file-pick">
          <input
            className="sr-only"
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          {form.file || form.keep ? 'Trocar arquivo' : 'Anexar imagem ou PDF'}
        </label>
        {fileProblem && (
          <ul className="problems" role="alert">
            <li>{fileProblem}</li>
          </ul>
        )}
      </div>

      {filled(form) && (
        <button type="button" className="link freight-clear" onClick={() => change({ ...blankFreight() })}>
          Limpar frete
        </button>
      )}

      {saved ? (
        <div className="freight-save" aria-live="polite">
          {saving.state === 'refused' && (
            <ul className="problems" role="alert">
              {saving.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {current && saving.state !== 'refused' && (
            <p className="hint">
              {saving.state === 'saved' ? 'Frete atualizado' : 'Frete salvo'} em {when(current.savedAt)}.
            </p>
          )}
          <button
            type="button"
            className="save-button"
            onClick={update}
            disabled={saving.state === 'saving' || !differs(form, current)}
          >
            {saving.state === 'saving' ? 'Salvando…' : `Atualizar frete da proposta ${saved.number}`}
          </button>
        </div>
      ) : (
        <p className="hint">O frete é salvo junto com a proposta.</p>
      )}

      {history.length > 1 && (
        <details className="freight-history">
          <summary>Versões anteriores ({history.length - 1})</summary>
          <ol>
            {history.slice(1).map((v) => (
              <li key={v.id}>
                <strong>{when(v.savedAt)}</strong>: {v.carrier}, transportadora {brl(v.quotedBRL)}, cobrado{' '}
                {brl(v.chargedBRL)}, cotação de {day(v.quoteDate)}
                {v.tracking && `, rastreio ${v.tracking}`}
                {v.file && <>, {fileLink(v.file)}</>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </details>
  )
}
