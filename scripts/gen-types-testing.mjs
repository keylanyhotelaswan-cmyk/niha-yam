/**
 * Generate TypeScript Database types from the Testing Supabase project.
 * Testing-only (ADR-0036). Does not touch Production.
 *
 * Usage: pnpm types:testing
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  TESTING_SUPABASE_REF,
  assertTestingTarget,
  loadTestingEnv,
} from './load-env.mjs'

const OUT = resolve('src/types/database.generated.ts')

function main() {
  const env = loadTestingEnv()
  assertTestingTarget(env.VITE_SUPABASE_URL)

  console.log(`→ Generating types from Testing (${TESTING_SUPABASE_REF})…`)
  const result = spawnSync(
    'npx',
    [
      'supabase',
      'gen',
      'types',
      'typescript',
      '--project-id',
      TESTING_SUPABASE_REF,
    ],
    {
      encoding: 'utf8',
      shell: true,
      env: process.env,
    },
  )

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || 'gen types failed')
    process.exit(result.status ?? 1)
  }

  const body = result.stdout
  if (!body || !body.includes('export type Database')) {
    console.error('FAIL: unexpected gen types output (missing Database export)')
    process.exit(1)
  }

  writeFileSync(OUT, body.endsWith('\n') ? body : body + '\n', 'utf8')
  console.log(`OK: wrote ${OUT}`)
}

main()
