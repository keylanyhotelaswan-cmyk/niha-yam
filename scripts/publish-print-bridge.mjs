import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertSupabaseUrl, loadProjectEnv } from './load-env.mjs'

/**
 * Publish NIHA Print Bridge for Windows and stage it under public/downloads/
 * so Print Center can offer: الإدارة → مركز الطباعة → تنزيل Bridge
 *
 *   pnpm bridge:publish
 *
 * Produces:
 *   - niha-print-bridge-win-x64.zip  (auto-update package)
 *   - NihaPrintBridge-Setup.exe      (Inno Setup, if ISCC available)
 *   - bridge-manifest.json           (version, notes, setupUrl, url)
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const project = path.join(root, 'apps', 'print-bridge', 'Niha.PrintBridge.csproj')
const publishDir = path.join(root, 'apps', 'print-bridge', 'publish', 'win-x64')
const downloadsDir = path.join(root, 'public', 'downloads')
const zipName = 'niha-print-bridge-win-x64.zip'
const zipPath = path.join(downloadsDir, zipName)
const stagingZipDir = path.join(root, 'apps', 'print-bridge', 'publish', 'stage')
const issPath = path.join(root, 'apps', 'print-bridge', 'installer', 'NihaPrintBridge.iss')
const changelogPath = path.join(root, 'apps', 'print-bridge', 'BRIDGE_CHANGELOG.md')

const env = loadProjectEnv()
const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
assertSupabaseUrl(url)
if (!anonKey) {
  console.error('FAIL: VITE_SUPABASE_ANON_KEY missing')
  process.exit(1)
}

const csproj = readFileSync(project, 'utf8')
const versionMatch = csproj.match(/<Version>([^<]+)<\/Version>/)
const version = versionMatch?.[1]?.trim() || '0.1.0'

console.log(`Publishing NIHA Print Bridge v${version} (win-x64, self-contained)…`)

// Prefer a fresh output dir; if the default folder is locked (running Bridge),
// publish beside it so staging to public/downloads still succeeds.
let outDir = publishDir
try {
  rmSync(publishDir, { recursive: true, force: true })
  mkdirSync(publishDir, { recursive: true })
} catch (e) {
  const code = e && typeof e === 'object' && 'code' in e ? e.code : null
  if (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY') {
    outDir = path.join(root, 'apps', 'print-bridge', 'publish', `win-x64-${version}`)
    console.warn(
      `WARN: ${publishDir} is locked (Bridge running?). Publishing to ${outDir}`,
    )
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(outDir, { recursive: true })
  } else {
    throw e
  }
}

execFileSync(
  'dotnet',
  [
    'publish',
    project,
    '-c',
    'Release',
    '-r',
    'win-x64',
    '--self-contained',
    'true',
    '-p:PublishSingleFile=true',
    '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-o',
    outDir,
  ],
  { stdio: 'inherit', cwd: root },
)

const defaults = {
  supabaseUrl: url,
  anonKey,
  version,
  printCenterUrl: env.VITE_APP_ORIGIN
    ? `${String(env.VITE_APP_ORIGIN).replace(/\/$/, '')}/admin/print`
    : 'https://niha-yam.vercel.app/admin/print',
}
writeFileSync(
  path.join(outDir, 'bridge-defaults.json'),
  JSON.stringify(defaults, null, 2),
  'utf8',
)

writeFileSync(
  path.join(outDir, 'INSTALL.txt'),
  [
    'NIHA Print Bridge',
    `Version: ${version}`,
    '',
    'Recommended: run NihaPrintBridge-Setup.exe from Print Center.',
    '',
    'Zip install (IT):',
    '1. Extract this zip on the Windows PC next to the printers.',
    '2. Run Niha.PrintBridge.exe (tray icon + Arabic window).',
    '3. In admin: Print Center → Pair Bridge → copy Pairing Token or show QR.',
    '4. In Bridge: Paste token (no camera) or Scan QR — short code is for first env only.',
    '',
    'Data (pairing survives updates): %LocalAppData%\\NihaPrintBridge\\',
    'Logs: %LocalAppData%\\NihaPrintBridge\\bridge.log',
    '',
  ].join('\n'),
  'utf8',
)

rmSync(stagingZipDir, { recursive: true, force: true })
mkdirSync(stagingZipDir, { recursive: true })
const stageApp = path.join(stagingZipDir, 'NihaPrintBridge')
mkdirSync(stageApp, { recursive: true })

for (const name of [
  'Niha.PrintBridge.exe',
  'bridge-defaults.json',
  'INSTALL.txt',
]) {
  const src = path.join(outDir, name)
  if (!existsSync(src)) {
    console.error(`FAIL: missing ${src}`)
    process.exit(1)
  }
  copyFileSync(src, path.join(stageApp, name))
}

const pdb = path.join(outDir, 'Niha.PrintBridge.pdb')
if (existsSync(pdb)) copyFileSync(pdb, path.join(stageApp, 'Niha.PrintBridge.pdb'))

mkdirSync(downloadsDir, { recursive: true })
rmSync(zipPath, { force: true })

execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${stageApp.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
  ],
  { stdio: 'inherit' },
)

const notes = readChangelogNotes(changelogPath, version)

let setupFile = null
let setupUrl = null
const iscc = findIscc()
if (iscc) {
  console.log(`Building Setup.exe with ${iscc}…`)
  const r = spawnSync(
    iscc,
    [
      issPath,
      `/DMyAppVersion=${version}`,
      `/DMyPublishDir=${outDir}`,
      `/DMyOutputDir=${downloadsDir}`,
    ],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) {
    console.warn('WARN: Inno Setup compile failed — zip still published.')
    if (r.stdout) console.warn(r.stdout)
    if (r.stderr) console.warn(r.stderr)
  } else {
    setupFile = 'NihaPrintBridge-Setup.exe'
    setupUrl = `/downloads/${setupFile}`
    const versioned = path.join(downloadsDir, `NihaPrintBridge-Setup-${version}.exe`)
    const setupPath = path.join(downloadsDir, setupFile)
    if (existsSync(setupPath)) {
      copyFileSync(setupPath, versioned)
      console.log(`OK: ${setupPath}`)
    }
  }
} else {
  console.warn(
    'WARN: Inno Setup (ISCC.exe) not found — skipping Setup.exe. Install from https://jrsoftware.org/isinfo.php then re-run pnpm bridge:publish',
  )
}

const sizeBytes = existsSync(zipPath) ? statSync(zipPath).size : null
const manifest = {
  name: 'NIHA Print Bridge',
  version,
  file: zipName,
  url: `/downloads/${zipName}`,
  setupFile,
  setupUrl,
  platform: 'win-x64',
  selfContained: true,
  publishedAt: new Date().toISOString(),
  sizeBytes,
  notes,
}

writeFileSync(
  path.join(downloadsDir, 'bridge-manifest.json'),
  JSON.stringify(manifest, null, 2),
  'utf8',
)

console.log(`\nOK: ${zipPath}`)
console.log(`Build output: ${outDir}`)
console.log(`Manifest: public/downloads/bridge-manifest.json (v${version})`)
console.log(`Print Center zip: ${manifest.url}`)
if (setupUrl) console.log(`Print Center setup: ${setupUrl}`)

function readChangelogNotes(file, ver) {
  if (!existsSync(file)) return `NIHA Print Bridge ${ver}`
  const text = readFileSync(file, 'utf8')
  const re = new RegExp(
    `##\\s*${ver.replace(/\./g, '\\.')}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
  )
  const m = text.match(re)
  if (!m) return `NIHA Print Bridge ${ver}`
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .join('\n')
}

function findIscc() {
  const localApp = process.env.LOCALAPPDATA || ''
  const candidates = [
    process.env.INNO_SETUP_ISCC,
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    localApp ? path.join(localApp, 'Programs', 'Inno Setup 6', 'ISCC.exe') : null,
  ].filter(Boolean)
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  const which = spawnSync(
    'where.exe',
    ['ISCC.exe'],
    { encoding: 'utf8' },
  )
  if (which.status === 0) {
    const line = which.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (line && existsSync(line)) return line
  }
  return null
}
