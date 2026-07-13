import { useCallback, useMemo, useState } from 'react'
import type { CartLine, PosMenuItem } from '@/features/pos/types'

function lineUnitPrice(
  item: PosMenuItem,
  modifierOptionIds: string[],
  openPrice?: number,
): number {
  let unit = item.is_open_price ? (openPrice ?? 0) : item.base_price
  for (const group of item.modifier_groups) {
    for (const optId of modifierOptionIds) {
      const opt = group.options.find((o) => o.id === optId)
      if (opt) unit += opt.price_delta
    }
  }
  return unit
}

function modifierSummary(item: PosMenuItem, modifierOptionIds: string[]): string {
  const names: string[] = []
  for (const group of item.modifier_groups) {
    for (const optId of modifierOptionIds) {
      const opt = group.options.find((o) => o.id === optId)
      if (opt) names.push(opt.name)
    }
  }
  return names.join('، ')
}

export function usePosCart() {
  const [lines, setLines] = useState<CartLine[]>([])

  const subtotal = useMemo(
    () =>
      Math.round(
        lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0) * 100,
      ) / 100,
    [lines],
  )

  const clear = useCallback(() => setLines([]), [])

  const addItem = useCallback(
    (
      item: PosMenuItem,
      opts: {
        quantity?: number
        modifierOptionIds?: string[]
        openPrice?: number
        note?: string
      } = {},
    ) => {
      const modifierOptionIds = opts.modifierOptionIds ?? []
      const quantity = opts.quantity ?? 1
      const unitPrice = lineUnitPrice(item, modifierOptionIds, opts.openPrice)
      const line: CartLine = {
        key: crypto.randomUUID(),
        menuItemId: item.id,
        name: item.name,
        sku: item.sku,
        unitPrice,
        quantity,
        modifierOptionIds,
        modifierSummary: modifierSummary(item, modifierOptionIds),
        openPrice: item.is_open_price ? opts.openPrice : undefined,
        note: opts.note,
        isOpenPrice: item.is_open_price,
      }
      setLines((prev) => [...prev, line])
      return line.key
    },
    [],
  )

  const updateQuantity = useCallback((key: string, quantity: number) => {
    if (quantity < 1) {
      setLines((prev) => prev.filter((l) => l.key !== key))
      return
    }
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantity } : l)),
    )
  }, [])

  const removeLine = useCallback((key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key))
  }, [])

  const updateNote = useCallback((key: string, note: string) => {
    const trimmed = note.trim()
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? { ...l, note: trimmed ? trimmed : undefined }
          : l,
      ),
    )
  }, [])

  const replaceLines = useCallback((next: CartLine[]) => {
    setLines(next)
  }, [])

  return {
    lines,
    subtotal,
    addItem,
    updateQuantity,
    removeLine,
    updateNote,
    clear,
    replaceLines,
  }
}
