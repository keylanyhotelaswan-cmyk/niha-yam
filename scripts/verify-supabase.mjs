import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

async function main() {
  const env = loadProjectEnv()
  const url = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY

  try {
    assertSupabaseUrl(url)
  } catch (error) {
    console.error('FAIL:', error instanceof Error ? error.message : error)
    process.exit(1)
  }

  if (!anonKey) {
    console.error('FAIL: Missing VITE_SUPABASE_ANON_KEY in .env.local')
    process.exit(1)
  }

  if (anonKey === 'your-anon-key' || url.includes('127.0.0.1')) {
    console.error(
      'FAIL: .env.local still contains placeholder Supabase values.',
    )
    process.exit(1)
  }

  const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  })

  if (!response.ok) {
    console.error(
      `FAIL: Supabase health check returned HTTP ${response.status}`,
    )
    process.exit(1)
  }

  console.log('OK: Connected to Supabase Cloud at', url)
}

main().catch((error) => {
  console.error('FAIL:', error instanceof Error ? error.message : error)
  process.exit(1)
})
