/** App deployment target — Production vs isolated Testing. */

export type AppEnv = 'production' | 'testing' | 'development'

export function getAppEnv(): AppEnv {
  const explicit = (import.meta.env.VITE_APP_ENV ?? '').toLowerCase().trim()
  if (explicit === 'testing' || explicit === 'test') return 'testing'

  const url = import.meta.env.VITE_SUPABASE_URL ?? ''
  if (url.includes('xywgmolpnhimivwmsmpw')) return 'testing'

  if (import.meta.env.DEV) return 'development'
  return 'production'
}

export function isTestingEnv(): boolean {
  return getAppEnv() === 'testing'
}
