/**
 * The page's side of the admin area. The token from logging in is kept for
 * this browser tab only (sessionStorage), and is good for 12 hours.
 */

import type { Settings } from '../settings/format.ts'

const TOKEN_KEY = 'packing-calculator:admin'

/** Raised when the server no longer accepts the token, so the page can ask to log in again. */
export class LoggedOut extends Error {}

export function savedToken(): string | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null')
    if (saved && typeof saved === 'object' && 'token' in saved && 'expiresAt' in saved) {
      const { token, expiresAt } = saved as { token: string; expiresAt: string }
      if (new Date(expiresAt).getTime() > Date.now()) return token
    }
  } catch {
    // Storage may be refused; the admin then logs in each time.
  }
  return null
}

export function forgetToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing kept, nothing to forget.
  }
}

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  } catch {
    throw new Error('Sem conexão com o servidor. Confira a internet e tente de novo.')
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? String(body.error) : ''
    if (response.status === 401 && token) {
      forgetToken()
      throw new LoggedOut(error || 'Entre de novo como administrador.')
    }
    throw new Error(error || `O servidor respondeu com erro (${response.status}).`)
  }
  return body as T
}

export async function logIn(password: string): Promise<string> {
  const session = await call<{ token: string; expiresAt: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(session))
  } catch {
    // Kept in memory only; the page still works.
  }
  return session.token
}

export const checkSession = (token: string) => call<{ ok: true }>('/api/admin/session', {}, token)

export const correctProposal = (token: string, id: number, change: { number: string; responsible: string }) =>
  call<{ correctedAt: string }>(`/api/admin/proposals/${id}`, { method: 'PATCH', body: JSON.stringify(change) }, token)

export const deleteProposal = (token: string, id: number) =>
  call<{ deleted: true }>(`/api/admin/proposals/${id}`, { method: 'DELETE' }, token)

export const saveSettings = (token: string, settings: Settings) =>
  call<{ settings: Settings; savedAt: string | null }>(
    '/api/admin/settings',
    { method: 'PUT', body: JSON.stringify(settings) },
    token,
  )
