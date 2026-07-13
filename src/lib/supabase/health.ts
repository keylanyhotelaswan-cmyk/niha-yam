import { isSupabaseConfigured } from '@/lib/supabase/client'

export type SupabaseHealthResult = {
  ok: boolean
  url: string
  message: string
}

const PLACEHOLDER_KEY = 'your-anon-key'

function normalizeSupabaseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

async function pingSupabaseApi(
  url: string,
  anonKey: string,
): Promise<Response> {
  return fetch(`${normalizeSupabaseUrl(url)}/auth/v1/health`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  })
}

export async function checkSupabaseConnection(): Promise<SupabaseHealthResult> {
  const url = import.meta.env.VITE_SUPABASE_URL ?? ''
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

  if (!isSupabaseConfigured) {
    return {
      ok: false,
      url: url || 'not set',
      message: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local',
    }
  }

  if (anonKey === PLACEHOLDER_KEY || url.includes('127.0.0.1')) {
    return {
      ok: false,
      url,
      message:
        'Replace placeholder values in .env.local with your Supabase Cloud project URL and anon key.',
    }
  }

  if (!url.includes('supabase.co')) {
    return {
      ok: false,
      url,
      message:
        'Expected a Supabase Cloud URL (https://<project-ref>.supabase.co).',
    }
  }

  try {
    const response = await pingSupabaseApi(url, anonKey)

    if (!response.ok) {
      return {
        ok: false,
        url,
        message: `Supabase API returned HTTP ${response.status}. Check URL and anon key.`,
      }
    }

    return {
      ok: true,
      url,
      message: 'Connected to Supabase Cloud successfully.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error'
    return {
      ok: false,
      url,
      message: `Could not reach Supabase: ${message}`,
    }
  }
}
