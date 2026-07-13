/**
 * Token-only enforcement (ADR-0003).
 *
 * Fails if raw color / arbitrary visual literals appear inside product code
 * (`src/features/**` and `src/shared/components/**`). Components must use only
 * token-backed utilities. `src/index.css` (token definitions) and the design-system
 * doc page are exempt — the latter documents token raw values on purpose.
 *
 * Cross-platform (Node only) so it runs identically on Windows and CI.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOTS = ['src/features', 'src/shared/components']

// Directories/files exempt from the rule (documented exceptions).
const EXEMPT = [
  join('src', 'app', 'routes', 'admin', 'design-system'), // documents raw token values
]

// Raw color / arbitrary-value patterns that must not appear in components.
const PATTERNS = [
  { re: /#[0-9a-fA-F]{3,8}\b/, label: 'hex color' },
  { re: /\brgb\(/, label: 'rgb() color' },
  { re: /\brgba\(/, label: 'rgba() color' },
  { re: /\bhsl\(/, label: 'hsl() color' },
  { re: /\bhsla\(/, label: 'hsla() color' },
  { re: /\boklch\(/, label: 'oklch() color' },
  // Tailwind arbitrary values for color/radius/shadow, e.g. bg-[#fff], rounded-[13px], shadow-[...]
  {
    re: /(?:bg|text|border|ring|fill|stroke|shadow|rounded)-\[/,
    label: 'arbitrary utility value',
  },
]

function isExempt(path) {
  return EXEMPT.some((ex) => path.startsWith(ex))
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, files)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

const violations = []

for (const root of ROOTS) {
  let files
  try {
    files = walk(root)
  } catch {
    continue // root may not exist yet
  }
  for (const file of files) {
    const rel = relative(process.cwd(), file).split(sep).join('/')
    const relForExempt = relative(process.cwd(), file)
    if (isExempt(relForExempt)) continue

    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const { re, label } of PATTERNS) {
        if (re.test(line)) {
          violations.push(`${rel}:${i + 1}  ${label} → ${line.trim()}`)
        }
      }
    })
  }
}

if (violations.length > 0) {
  console.error('lint:tokens FAILED — raw visual values found in components:\n')
  console.error(violations.join('\n'))
  console.error(
    '\nUse design tokens only (see docs/adr/0003-design-tokens-only.md).',
  )
  process.exit(1)
}

console.log('lint:tokens OK — no raw colors/arbitrary values in components.')
