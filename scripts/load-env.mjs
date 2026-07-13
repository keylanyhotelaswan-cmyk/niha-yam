import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Minimal .env parser for local Node scripts (not Vite).
 * Supports KEY=value lines, optional quotes, UTF-8 BOM, and Windows CRLF.
 */
export function loadEnvFile(filePath) {
  const values = {}
  const content = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    value = value.replace(/\r$/, '')

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    values[key] = value
  }

  return values
}

export function loadProjectEnv(cwd = process.cwd()) {
  return loadEnvFile(resolve(cwd, '.env.local'))
}

const SUPABASE_URL_PATTERN = /^https?:\/\/[^/\s]+/i

export function assertSupabaseUrl(url, label = 'VITE_SUPABASE_URL') {
  if (!url) {
    throw new Error(`Missing ${label} in .env.local`)
  }

  if (!SUPABASE_URL_PATTERN.test(url)) {
    throw new Error(
      `Invalid ${label}: expected https://YOUR_PROJECT_REF.supabase.co (got "${url}")`,
    )
  }

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('protocol must be http or https')
    }
  } catch {
    throw new Error(
      `Invalid ${label}: expected https://YOUR_PROJECT_REF.supabase.co (got "${url}")`,
    )
  }
}
