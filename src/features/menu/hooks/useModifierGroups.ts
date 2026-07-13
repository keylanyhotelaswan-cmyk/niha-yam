import { useQuery } from '@tanstack/react-query'
import { fetchModifierGroups } from '@/features/menu/api/menu.api'
import { menuKeys } from '@/features/menu/hooks/menu.keys'

/** Modifier groups query (with nested options). */
export function useModifierGroups() {
  return useQuery({
    queryKey: menuKeys.modifierGroups(),
    queryFn: fetchModifierGroups,
  })
}
