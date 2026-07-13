import { createClient } from '@supabase/supabase-js'
import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

const SEED_RESTAURANT_ID = 'a0000000-0000-4000-8000-000000000001'
const SEED_BRANCH_ID = 'b0000000-0000-4000-8000-000000000001'

// Keep in sync with src/features/auth/internal-email.ts and the staff-create Edge Function.
const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/

function readArg(name) {
  const idx = process.argv.indexOf(name)
  if (idx === -1 || !process.argv[idx + 1]) return null
  return process.argv[idx + 1]
}

function hasFlag(name) {
  return process.argv.includes(name)
}

async function main() {
  const username = (readArg('--username') ?? '').trim().toLowerCase()
  const password = readArg('--password')
  const name = readArg('--name')
  const reset = hasFlag('--reset')

  if (!username || !password || !name) {
    console.error(
      'Usage: pnpm bootstrap:owner -- --username owner --password "secret" --name "Owner Name" [--reset]',
    )
    process.exit(1)
  }

  if (!USERNAME_RE.test(username)) {
    console.error(
      'FAIL: username must be 3–32 chars: lowercase letters, digits, . _ -',
    )
    process.exit(1)
  }

  const env = loadProjectEnv()
  const url = env.VITE_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

  try {
    assertSupabaseUrl(url)
  } catch (error) {
    console.error('FAIL:', error instanceof Error ? error.message : error)
    process.exit(1)
  }

  if (!serviceKey) {
    console.error('FAIL: Set SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Q-C: re-bootstrap on the username model. --reset discards existing staff by
  // deleting their auth users (staff + staff_branches cascade; audit_log actor is nulled).
  if (reset) {
    const { data: existing, error: listError } = await admin
      .from('staff')
      .select('user_id')
    if (listError) {
      console.error('FAIL: listing staff for reset:', listError.message)
      process.exit(1)
    }
    for (const row of existing ?? []) {
      const { error: delError } = await admin.auth.admin.deleteUser(row.user_id)
      if (delError) {
        console.error('FAIL: deleting existing user:', delError.message)
        process.exit(1)
      }
    }
    if ((existing ?? []).length > 0) {
      console.log(
        `  reset: removed ${existing.length} existing staff account(s)`,
      )
    }
  }

  const email = `${username}@${INTERNAL_EMAIL_DOMAIN}`

  const { data: userData, error: userError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, display_name: name },
    })

  if (userError || !userData.user) {
    console.error('FAIL: createUser:', userError?.message ?? 'unknown error')
    process.exit(1)
  }

  const { data: staffId, error: rpcError } = await admin.rpc(
    'bootstrap_owner_staff',
    {
      p_user_id: userData.user.id,
      p_username: username,
      p_display_name: name,
      p_restaurant_id: SEED_RESTAURANT_ID,
      p_branch_id: SEED_BRANCH_ID,
    },
  )

  if (rpcError) {
    await admin.auth.admin.deleteUser(userData.user.id)
    if (rpcError.message.includes('BOOTSTRAP_ALREADY_DONE')) {
      console.error(
        'FAIL: staff already exist. Re-run with --reset to re-bootstrap the owner.',
      )
    } else {
      console.error('FAIL: bootstrap_owner_staff:', rpcError.message)
    }
    process.exit(1)
  }

  console.log('OK: Owner bootstrapped successfully')
  console.log('  staff_id:', staffId)
  console.log('  username:', username)
  console.log('  login: http://127.0.0.1:5173/login')
}

main().catch((error) => {
  console.error('FAIL:', error instanceof Error ? error.message : error)
  process.exit(1)
})
