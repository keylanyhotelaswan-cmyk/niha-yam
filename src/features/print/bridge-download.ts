/** Official Print Center download paths for NIHA Print Bridge (BP-14). */
export const BRIDGE_DOWNLOAD = {
  zipUrl: '/downloads/niha-print-bridge-win-x64.zip',
  setupUrl: '/downloads/NihaPrintBridge-Setup.exe',
  manifestUrl: '/downloads/bridge-manifest.json',
} as const

export type BridgeManifest = {
  name: string
  version: string
  file: string
  url: string
  /** Optional Inno Setup installer path (preferred for cashiers). */
  setupUrl?: string | null
  setupFile?: string | null
  platform: string
  selfContained: boolean
  publishedAt: string
  sizeBytes: number | null
  /** Arabic What’s New for Bridge updater UI. */
  notes?: string | null
}

export async function fetchBridgeManifest(): Promise<BridgeManifest | null> {
  try {
    const res = await fetch(BRIDGE_DOWNLOAD.manifestUrl, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as BridgeManifest
  } catch {
    return null
  }
}

/** Compare dotted versions (e.g. 0.3.10 vs 0.3.11.0). Negative = a < b. */
export function compareBridgeVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .map((p) => {
        const n = Number.parseInt(p, 10)
        return Number.isFinite(n) ? n : 0
      })
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d < 0) return -1
    if (d > 0) return 1
  }
  return 0
}

export function isBridgeUpdateAvailable(
  installed: string | null | undefined,
  latest: string | null | undefined,
): boolean {
  if (!installed || !latest) return false
  return compareBridgeVersions(installed, latest) < 0
}

/** Build QR / paste payload for Bridge pairing (includes cloud endpoints). */
export function buildPairPayload(code: string): string {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : ''
  return JSON.stringify({
    v: 1,
    url: import.meta.env.VITE_SUPABASE_URL,
    anon: import.meta.env.VITE_SUPABASE_ANON_KEY,
    code: code.trim().toUpperCase(),
    restaurantName: tBrandFallback(),
    printCenterUrl: origin ? `${origin}/admin/print` : undefined,
  })
}

/**
 * Single-line Pairing Token (base64url of the same JSON as QR).
 * Equal to QR for cashiers without a camera — paste into Bridge.
 */
export function buildPairingToken(code: string): string {
  const json = buildPairPayload(code)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function tBrandFallback(): string {
  // Avoid circular i18n import in this module — brand is stable.
  return 'NIHA'
}
