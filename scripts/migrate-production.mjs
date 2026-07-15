/**
 * Apply all repo migrations to the Production Supabase project.
 * Does NOT run seed. Seed is Testing-only.
 *
 * Usage: pnpm migrate:production
 */
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  PRODUCTION_SUPABASE_REF,
  TESTING_SUPABASE_REF,
} from './load-env.mjs'

const PROJECT_REF_PATH = resolve('supabase/.temp/project-ref')

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function main() {
  mkdirSync(dirname(PROJECT_REF_PATH), { recursive: true })
  const previous = existsSync(PROJECT_REF_PATH)
    ? readFileSync(PROJECT_REF_PATH, 'utf8').trim()
    : PRODUCTION_SUPABASE_REF

  if (previous === TESTING_SUPABASE_REF) {
    console.warn(
      `WARN: CLI was linked to Testing; switching to Production (${PRODUCTION_SUPABASE_REF}) for this run.`,
    )
  }

  writeFileSync(PROJECT_REF_PATH, PRODUCTION_SUPABASE_REF + '\n', 'utf8')

  try {
    console.log(`→ Pushing migrations to Production (${PRODUCTION_SUPABASE_REF})…`)
    run('supabase', ['db', 'push', '--yes'])

    console.log('→ Deploying Edge Functions to Production…')
    run('supabase', [
      'functions',
      'deploy',
      '--project-ref',
      PRODUCTION_SUPABASE_REF,
    ])
  } finally {
    writeFileSync(PROJECT_REF_PATH, PRODUCTION_SUPABASE_REF + '\n', 'utf8')
  }

  console.log('OK: Production schema + functions are up to date.')
  console.log('  (Seed was NOT run — seed is Testing-only.)')
}

main()
