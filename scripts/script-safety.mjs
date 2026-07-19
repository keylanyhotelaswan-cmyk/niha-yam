/**
 * NIHA script safety — Production is never mutated by smoke/test/simulation/fuzz/chaos.
 *
 * Policy (ADR-0035):
 * - Protected scripts may mutate Testing only.
 * - Against Production they are read-only (health / diagnose / list / get).
 * - Explicit owner exception: NIHA_ALLOW_PROD_MUTATION=1 (never set by default).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  PRODUCTION_SUPABASE_REF,
  TESTING_SUPABASE_REF,
  assertSupabaseUrl,
} from './load-env.mjs'

const MUTATION_OVERRIDE = 'NIHA_ALLOW_PROD_MUTATION'

/** Basename patterns covered by the policy. */
const PROTECTED_BASENAME =
  /^(smoke|test|simulate|fuzz|chaos)([-._]|$)|(^|[-._])chaos([-._]|$)/i

let _printedProdReadOnlyBanner = false
let _printedProdWriteBlockedBanner = false
let _printedProdWriteOverrideBanner = false

export function productionReadOnlyBanner() {
  return [
    '====================================',
    '⚠️ PRODUCTION MODE',
    'Read Only',
    '====================================',
  ].join('\n')
}

export function productionWriteBlockedBanner() {
  return [
    '====================================',
    '❌ Production Write Blocked',
    'To continue use:',
    `${MUTATION_OVERRIDE}=1`,
    '====================================',
  ].join('\n')
}

/** Call when a protected script is connected to Production in read-only mode. */
export function announceProductionReadOnlyMode(url) {
  if (!isProductionSupabaseUrl(url)) return
  if (_printedProdReadOnlyBanner) return
  _printedProdReadOnlyBanner = true
  console.log(`\n${productionReadOnlyBanner()}\n`)
}

/** Call when a write is refused on Production (no override). */
export function announceProductionWriteBlocked() {
  if (_printedProdWriteBlockedBanner) return
  _printedProdWriteBlockedBanner = true
  console.error(`\n${productionWriteBlockedBanner()}\n`)
}

function announceProductionWriteOverride(scriptPath) {
  if (_printedProdWriteOverrideBanner) return
  _printedProdWriteOverrideBanner = true
  console.warn(
    [
      '',
      '====================================',
      '⚠️ PRODUCTION WRITE OVERRIDE',
      `${MUTATION_OVERRIDE}=1`,
      path.basename(scriptPath || 'script'),
      '====================================',
      '',
    ].join('\n'),
  )
}

export function getInvokingScriptPath() {
  const arg = process.argv[1]
  if (!arg) return ''
  try {
    return path.resolve(arg)
  } catch {
    return String(arg)
  }
}

export function isProtectedScriptName(scriptPath = getInvokingScriptPath()) {
  const base = path.basename(scriptPath || '').toLowerCase()
  if (!base) return false
  // Shared helper used only by chaos suites — treat as protected when invoked via chaos entrypoints.
  if (base === 'chaos-lib.mjs' || base === 'script-safety.mjs') return true
  return PROTECTED_BASENAME.test(base)
}

export function isProductionSupabaseUrl(url) {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.startsWith(`${PRODUCTION_SUPABASE_REF}.`)
  } catch {
    return String(url).includes(PRODUCTION_SUPABASE_REF)
  }
}

export function isTestingSupabaseUrl(url) {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.startsWith(`${TESTING_SUPABASE_REF}.`)
  } catch {
    return String(url).includes(TESTING_SUPABASE_REF)
  }
}

export function prodMutationOverrideEnabled() {
  return process.env[MUTATION_OVERRIDE] === '1'
}

/**
 * Hard stop: mutating protected scripts must not target Production.
 * Call at the start of any script that opens shifts, posts purchases, etc.
 */
export function refuseProductionMutations(
  url,
  {
    scriptPath = getInvokingScriptPath(),
    label = 'script',
  } = {},
) {
  assertSupabaseUrl(url)
  if (!isProtectedScriptName(scriptPath)) return
  if (!isProductionSupabaseUrl(url)) return
  if (prodMutationOverrideEnabled()) {
    announceProductionWriteOverride(scriptPath)
    return
  }
  announceProductionWriteBlocked()
  throw new Error(
    [
      `Production Write Blocked — ${path.basename(scriptPath) || label}`,
      `Use Testing (.env.testing) for mutative tests,`,
      `or set ${MUTATION_OVERRIDE}=1 only with an explicit owner order.`,
    ].join('\n'),
  )
}

/** True if RPC name is considered safe on Production (read / diagnose / list). */
export function isReadOnlyRpcName(fn) {
  const name = String(fn || '').toLowerCase()
  if (!name) return false
  if (
    name.startsWith('get_') ||
    name.startsWith('list_') ||
    name.startsWith('diagnose_') ||
    name.startsWith('verify_') ||
    name.startsWith('m6_match_') ||
    name.startsWith('m6_printer_')
  ) {
    return true
  }
  const allow = new Set([
    'treasury_balance',
    'liq_get_snapshot',
    'auth_restaurant_id',
    'is_owner_or_manager',
  ])
  return allow.has(name)
}

function readonlyError(action) {
  announceProductionWriteBlocked()
  return {
    data: null,
    error: {
      message: `PRODUCTION_READONLY: ${action} blocked by script-safety policy`,
      code: 'PRODUCTION_READONLY',
    },
    count: null,
    status: 403,
    statusText: 'Forbidden',
  }
}

function wrapThenable(result) {
  if (result == null || typeof result !== 'object') return result
  if (typeof result.then === 'function') return result
  return wrapBuilder(result)
}

function wrapBuilder(builder) {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (
        prop === 'insert' ||
        prop === 'update' ||
        prop === 'delete' ||
        prop === 'upsert'
      ) {
        return () => Promise.resolve(readonlyError(`from().${String(prop)}()`))
      }
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      return (...args) => wrapThenable(value.apply(target, args))
    },
  })
}

/**
 * Supabase client that cannot mutate Production when used from a protected script.
 * @param {'auto'|'readonly'|'mutating'} mode
 *   - auto: Production → read-only wrap; Testing → full client; mutative scripts already refused via refuseProductionMutations
 *   - readonly: always wrap when Production
 *   - mutating: refuse Production (unless override), else full client
 */
export function createScriptClient(url, key, options = {}) {
  const {
    mode = 'auto',
    scriptPath = getInvokingScriptPath(),
    auth = { autoRefreshToken: false, persistSession: false },
    ...rest
  } = options

  assertSupabaseUrl(url)
  const protectedScript = isProtectedScriptName(scriptPath)
  const production = isProductionSupabaseUrl(url)

  if (protectedScript && production && mode === 'mutating') {
    refuseProductionMutations(url, { scriptPath })
  }

  if (
    protectedScript &&
    production &&
    (mode === 'readonly' || mode === 'auto') &&
    !prodMutationOverrideEnabled()
  ) {
    announceProductionReadOnlyMode(url)
    // auto on Production for protected scripts = read-only (safe default)
    const raw = createClient(url, key, { auth, ...rest })
    return new Proxy(raw, {
      get(target, prop, receiver) {
        if (prop === 'from') {
          return (table) => wrapBuilder(target.from(table))
        }
        if (prop === 'rpc') {
          return (fn, args) => {
            if (!isReadOnlyRpcName(fn)) {
              return Promise.resolve(
                readonlyError(`rpc('${fn}')`),
              )
            }
            return target.rpc(fn, args)
          }
        }
        if (prop === 'storage') {
          return new Proxy(target.storage, {
            get(st, stProp) {
              if (stProp === 'from') {
                return (bucket) => {
                  const b = st.from(bucket)
                  return new Proxy(b, {
                    get(bt, bp) {
                      if (
                        bp === 'upload' ||
                        bp === 'update' ||
                        bp === 'remove' ||
                        bp === 'move' ||
                        bp === 'copy'
                      ) {
                        return async () => ({
                          data: null,
                          error: {
                            message: 'PRODUCTION_READONLY: storage mutation blocked',
                          },
                        })
                      }
                      const v = bt[bp]
                      return typeof v === 'function' ? v.bind(bt) : v
                    },
                  })
                }
              }
              const v = st[stProp]
              return typeof v === 'function' ? v.bind(st) : v
            },
          })
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }

  if (protectedScript && production && prodMutationOverrideEnabled()) {
    announceProductionWriteOverride(scriptPath)
  }

  return createClient(url, key, { auth, ...rest })
}

/**
 * Load path helper for mutative suites: Testing env only.
 */
export function requireTestingUrl(url, label = 'VITE_SUPABASE_URL') {
  assertSupabaseUrl(url, label)
  if (!isTestingSupabaseUrl(url)) {
    throw new Error(
      `Refusing: ${label} must be Testing (${TESTING_SUPABASE_REF}). Got ${url}`,
    )
  }
  if (isProductionSupabaseUrl(url)) {
    throw new Error(`Refusing: ${label} points at Production.`)
  }
  refuseProductionMutations(url)
}

export function policyBanner() {
  return [
    'Script safety: smoke/test/simulation/fuzz/chaos',
    '→ Testing: mutations allowed',
    '→ Production: read-only only (unless NIHA_ALLOW_PROD_MUTATION=1)',
  ].join('\n')
}

/** For docs / verify script — list this module path. */
export function safetyModulePath() {
  return fileURLToPath(import.meta.url)
}
