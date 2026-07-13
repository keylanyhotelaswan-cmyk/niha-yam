import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.generated'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local.',
  )
}

export const supabase = createClient<Database>(
  supabaseUrl ?? '',
  supabaseAnonKey ?? '',
)
