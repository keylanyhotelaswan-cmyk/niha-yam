import { useQuery } from '@tanstack/react-query'
import { fetchMenuAdmin } from '@/features/menu/api/menu.api'
import { menuKeys } from '@/features/menu/hooks/menu.keys'

/** Admin menu query (categories + items, including inactive/hidden). */
export function useMenuAdmin() {
  return useQuery({
    queryKey: menuKeys.admin(),
    queryFn: fetchMenuAdmin,
  })
}
