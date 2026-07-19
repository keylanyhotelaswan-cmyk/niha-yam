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

/** Testing env — never falls back to production `.env.local`. */
export function loadTestingEnv(cwd = process.cwd()) {
  return loadEnvFile(resolve(cwd, '.env.testing'))
}

export const PRODUCTION_SUPABASE_REF = 'nzwgoavyrshuypkugvzc'
export const TESTING_SUPABASE_REF = 'xywgmolpnhimivwmsmpw'

export function assertTestingTarget(url, label = 'VITE_SUPABASE_URL') {
  assertSupabaseUrl(url, label)
  let host
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`Invalid ${label}`)
  }
  if (!host.startsWith(`${TESTING_SUPABASE_REF}.`)) {
    throw new Error(
      `Refusing to run: ${label} is not the Testing project (${TESTING_SUPABASE_REF}). Got ${host}`,
    )
  }
  if (host.includes(PRODUCTION_SUPABASE_REF)) {
    throw new Error(
      `Refusing to run: ${label} points at Production (${PRODUCTION_SUPABASE_REF}).`,
    )
  }
}

/** Assert URL is Production (for read-only Production smokes only). */
export function assertProductionTarget(url, label = 'VITE_SUPABASE_URL') {
  assertSupabaseUrl(url, label)
  let host
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error(`Invalid ${label}`)
  }
  if (!host.startsWith(`${PRODUCTION_SUPABASE_REF}.`)) {
    throw new Error(
      `Refusing: ${label} is not Production (${PRODUCTION_SUPABASE_REF}). Got ${host}`,
    )
  }
  if (host.includes(TESTING_SUPABASE_REF)) {
    throw new Error(`Refusing: ${label} points at Testing.`)
  }
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
