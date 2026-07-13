import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { printKeys } from '@/features/print/hooks/print.keys'
import { treasuryKeys } from '@/features/treasury/hooks/treasury.keys'

const TABLES = [
  'orders',
  'order_payments',
  'shifts',
  'shift_handovers',
  'ops_messages',
  'ops_feedback',
] as const

/**
 * Live invalidation for operational tables (orders hub, shift, treasury, print).
 * Mount once per shell (POS workspace + admin layout).
 */
export function useOpsRealtime(enabled = true) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return

    const channel = supabase.channel('ops-realtime')

    for (const table of TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['orders'] })
          void queryClient.invalidateQueries({ queryKey: posKeys.all })
          void queryClient.invalidateQueries({ queryKey: treasuryKeys.all })
          void queryClient.invalidateQueries({ queryKey: printKeys.all })
          void queryClient.invalidateQueries({ queryKey: ['ops-messages'] })
          void queryClient.invalidateQueries({ queryKey: ['ops-feedback'] })
        },
      )
    }

    void channel.subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [enabled, queryClient])
}
