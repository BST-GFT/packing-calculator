/**
 * The settings in use, fetched from the server once when the page opens and
 * shared with every screen. Until they arrive the calculator waits; if the
 * server cannot be reached, the factory defaults are used and the page says so.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { DEFAULT_SETTINGS, type Settings } from './format.ts'

export interface SettingsState {
  settings: Settings
  /** When the admin last saved them; null for the factory defaults. */
  savedAt: string | null
  status: 'loading' | 'ready' | 'fallback'
  /** Puts newly saved settings in use without reloading the page. */
  update: (settings: Settings, savedAt: string | null) => void
}

const SettingsContext = createContext<SettingsState>({
  settings: DEFAULT_SETTINGS,
  savedAt: null,
  status: 'loading',
  update: () => {},
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<SettingsState, 'update'>>({
    settings: DEFAULT_SETTINGS,
    savedAt: null,
    status: 'loading',
  })

  useEffect(() => {
    let current = true
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { settings: Settings; savedAt: string | null }) => {
        if (current) setState({ settings: body.settings, savedAt: body.savedAt, status: 'ready' })
      })
      .catch(() => {
        if (current) setState((s) => ({ ...s, status: 'fallback' }))
      })
    return () => {
      current = false
    }
  }, [])

  const update = (settings: Settings, savedAt: string | null) =>
    setState({ settings, savedAt, status: 'ready' })

  return <SettingsContext value={{ ...state, update }}>{children}</SettingsContext>
}

export const useSettings = () => useContext(SettingsContext)
