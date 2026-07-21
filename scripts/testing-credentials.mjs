/**
 * Shared Testing credentials for scripts (ADR-0035 / ADR-0036).
 * Prefer NIHA_TEST_* / TESTING_MANAGER_* from .env.testing; fall back to seed manager.
 */
import { loadTestingEnv } from './load-env.mjs'

const INTERNAL = 'staff.niha.local'

export function testingStaffCredentials(argv = process.argv) {
  const env = loadTestingEnv()
  const readArg = (name) => {
    const idx = argv.indexOf(name)
    if (idx === -1 || !argv[idx + 1]) return null
    return argv[idx + 1]
  }

  const username = (
    readArg('--username') ||
    process.env.NIHA_TEST_USER ||
    env.NIHA_TEST_USER ||
    env.TESTING_MANAGER_USERNAME ||
    'manager'
  )
    .trim()
    .toLowerCase()

  const password =
    readArg('--password') ||
    process.env.NIHA_TEST_PASSWORD ||
    env.NIHA_TEST_PASSWORD ||
    env.TESTING_MANAGER_PASSWORD ||
    'Testing123!'

  return {
    username,
    password,
    email: `${username}@${INTERNAL}`,
    env,
  }
}
