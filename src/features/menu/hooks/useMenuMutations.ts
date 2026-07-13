import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  setCategoryStatus,
  setItemStatus,
  setModifierGroupStatus,
  setModifierOptionStatus,
  upsertCategory,
  upsertItem,
  upsertModifierGroup,
  upsertModifierOption,
} from '@/features/menu/api/menu.api'
import { menuKeys } from '@/features/menu/hooks/menu.keys'
import type {
  UpsertCategoryInput,
  UpsertItemInput,
  UpsertModifierGroupInput,
  UpsertModifierOptionInput,
} from '@/features/menu/types'

/**
 * Menu mutations. Each invalidates the relevant cached query on success so the
 * list refreshes without a manual refetch or full reload (ADR-0010, ADR-0014).
 */

export function useUpsertCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertCategoryInput) => upsertCategory(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: menuKeys.admin() }),
  })
}

export function useSetCategoryStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setCategoryStatus(id, active),
    onSuccess: () => void qc.invalidateQueries({ queryKey: menuKeys.admin() }),
  })
}

export function useUpsertItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertItemInput) => upsertItem(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: menuKeys.admin() }),
  })
}

export function useSetItemStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setItemStatus(id, active),
    onSuccess: () => void qc.invalidateQueries({ queryKey: menuKeys.admin() }),
  })
}

export function useUpsertModifierGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertModifierGroupInput) => upsertModifierGroup(input),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: menuKeys.modifierGroups() }),
  })
}

export function useSetModifierGroupStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setModifierGroupStatus(id, active),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: menuKeys.modifierGroups() }),
  })
}

export function useUpsertModifierOption() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertModifierOptionInput) =>
      upsertModifierOption(input),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: menuKeys.modifierGroups() }),
  })
}

export function useSetModifierOptionStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setModifierOptionStatus(id, active),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: menuKeys.modifierGroups() }),
  })
}
