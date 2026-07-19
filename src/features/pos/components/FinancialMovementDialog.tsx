import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { posRecordExpense, posOperationalTransfer } from '@/features/pos/api/pos.api'
import { posKeys } from '@/features/pos/hooks/pos.keys'
import { treasuryKeys } from '@/features/treasury/hooks/treasury.keys'
import {
  createOpsIngredient,
  fetchOpsIngredients,
  fetchOpsSuppliers,
  fetchOpsUoms,
  postCreditPurchase,
  postDirectCashPurchase,
  type OpsIngredient,
} from '@/features/purchasing/api/purchasing.api'
import type {
  PurchaseSettlement,
  PurchaseSourceKind,
} from '@/features/purchasing/types'
import { usePermissions } from '@/shared/access/permissions'
import type { PosOperationalTreasury } from '@/features/pos/types'
import { formatMoney } from '@/features/treasury/utils/format'
import {
  shouldResetTransferForm,
  transferableAmount,
} from '@/features/pos/utils/transferable'
import {
  resolveTransferReason,
  TRANSFER_REASON_PRESETS,
  type TransferReasonPreset,
} from '@/features/pos/utils/saleMoney'
import {
  isInsufficientOperatingError,
  ReleaseReservedDialog,
} from '@/features/treasury/components/dialogs/ReleaseReservedDialog'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'

export type FinancialMoveKind = 'expense' | 'purchase' | 'transfer'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  treasuries: PosOperationalTreasury[]
  shiftId?: string | null
  canOperationalPurchase: boolean
  /** Optional initial kind when opening from a shortcut */
  initialKind?: FinancialMoveKind
}

type DraftLine = {
  key: string
  ingredient_id: string
  uom_id: string
  qty: string
  unit_price: string
}

export function FinancialMovementDialog({
  open,
  onOpenChange,
  treasuries,
  shiftId: _shiftId,
  canOperationalPurchase,
  initialKind = 'expense',
}: Props) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const canCredit = can('purchase.credit.create')
  const [kind, setKind] = useState<FinancialMoveKind>(initialKind)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Expense
  const [expAmount, setExpAmount] = useState('')
  const [expDescription, setExpDescription] = useState('')
  const [expVendor, setExpVendor] = useState('')

  // Purchase
  const [settlement, setSettlement] = useState<PurchaseSettlement>('cash')
  const [sourceKind, setSourceKind] = useState<PurchaseSourceKind>('direct')
  const [directLabel, setDirectLabel] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [treasuryId, setTreasuryId] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([
    {
      key: crypto.randomUUID(),
      ingredient_id: '',
      uom_id: '',
      qty: '1',
      unit_price: '',
    },
  ])
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUomId, setNewUomId] = useState('')
  const [creating, setCreating] = useState(false)

  // Transfer
  const [sourceId, setSourceId] = useState('')
  const [destId, setDestId] = useState('')
  const [xferAmount, setXferAmount] = useState('')
  const [reasonPreset, setReasonPreset] = useState<TransferReasonPreset | ''>('')
  const [reasonOther, setReasonOther] = useState('')
  const [wasOpen, setWasOpen] = useState(false)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releaseSuggest, setReleaseSuggest] = useState<number | null>(null)

  const drawer = useMemo(
    () => treasuries.find((row) => row.code === 'drawer'),
    [treasuries],
  )
  const digitals = useMemo(
    () => treasuries.filter((row) => row.code !== 'drawer'),
    [treasuries],
  )

  const ingredientsQ = useQuery({
    queryKey: ['purchasing', 'ops-ingredients'],
    queryFn: fetchOpsIngredients,
    enabled: open && kind === 'purchase' && canOperationalPurchase,
  })
  const uomsQ = useQuery({
    queryKey: ['purchasing', 'ops-uoms'],
    queryFn: fetchOpsUoms,
    enabled: open && kind === 'purchase' && canOperationalPurchase,
  })
  const suppliersQ = useQuery({
    queryKey: ['purchasing', 'ops-suppliers'],
    queryFn: fetchOpsSuppliers,
    enabled:
      open &&
      kind === 'purchase' &&
      canOperationalPurchase &&
      (sourceKind === 'supplier' || settlement === 'credit'),
  })

  useEffect(() => {
    if (open && !wasOpen) {
      const startKind =
        initialKind === 'purchase' && !canOperationalPurchase
          ? 'expense'
          : initialKind
      setKind(startKind)
      setError(null)
      setExpAmount('')
      setExpDescription('')
      setExpVendor('')
      setSettlement('cash')
      setSourceKind('direct')
      setDirectLabel('')
      setSupplierId('')
      setTreasuryId(drawer?.id ?? treasuries[0]?.id ?? '')
      setLines([
        {
          key: crypto.randomUUID(),
          ingredient_id: '',
          uom_id: '',
          qty: '1',
          unit_price: '',
        },
      ])
      setCreateOpen(false)
      setNewName('')
      setNewUomId('')
      setSourceId(drawer?.id ?? '')
      setDestId(digitals[0]?.id ?? '')
      setXferAmount('')
      setReasonPreset('')
      setReasonOther('')
    }
    setWasOpen(open)
  }, [
    open,
    wasOpen,
    initialKind,
    canOperationalPurchase,
    drawer?.id,
    digitals,
    treasuries,
  ])

  useEffect(() => {
    if (!open) return
    if (shouldResetTransferForm(false, open) && kind === 'transfer') {
      if (!sourceId && drawer?.id) setSourceId(drawer.id)
      if (!destId && digitals[0]?.id) setDestId(digitals[0].id)
    }
  }, [open, kind, drawer?.id, digitals, sourceId, destId])

  const purchaseTotal = lines.reduce((sum, line) => {
    const qty = Number(line.qty)
    const price = Number(line.unit_price)
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return sum
    return sum + qty * price
  }, 0)

  const source = treasuries.find((tr) => tr.id === sourceId)
  const sourceAvailable = transferableAmount(source)
  const destOptions = useMemo(() => {
    if (!source) return treasuries
    if (source.code === 'drawer') return digitals
    return drawer ? [drawer] : []
  }, [source, treasuries, digitals, drawer])

  async function submitExpense() {
    const value = Number(expAmount)
    if (!Number.isFinite(value) || value <= 0) {
      setError(t.pos.ops.invalidAmount)
      return
    }
    setSubmitting(true)
    try {
      await posRecordExpense({
        amount: value,
        category: 'petty_cash',
        description: expDescription || null,
        vendor: expVendor || null,
      })
      void queryClient.invalidateQueries({ queryKey: posKeys.context() })
      void queryClient.invalidateQueries({ queryKey: treasuryKeys.all })
      toast.success(t.pos.ops.expenseDone)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.pos.errors.generic)
    } finally {
      setSubmitting(false)
    }
  }

  async function submitPurchase() {
    if (!canOperationalPurchase) {
      setError(t.purchasing.errors.PERMISSION_DENIED)
      return
    }
    const ingredients = ingredientsQ.data ?? []
    const payloadLines = []
    for (const line of lines) {
      if (!line.ingredient_id) continue
      const ing = ingredients.find((i) => i.id === line.ingredient_id)
      const uom_id = line.uom_id || ing?.base_uom_id || ''
      const qty = Number(line.qty)
      const unit_price = Number(line.unit_price)
      if (!uom_id) {
        setError(t.pos.ops.purchasePickIngredient)
        return
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(t.pos.ops.purchaseNeedQty)
        return
      }
      if (!Number.isFinite(unit_price) || unit_price < 0) {
        setError(t.pos.ops.purchaseNeedPrice)
        return
      }
      payloadLines.push({
        ingredient_id: line.ingredient_id,
        qty,
        uom_id,
        unit_price,
      })
    }
    if (payloadLines.length === 0) {
      setError(t.pos.ops.purchaseLinesRequired)
      return
    }
    if (settlement === 'credit') {
      if (!canCredit) {
        setError(t.purchasing.errors.PERMISSION_DENIED)
        return
      }
      if (!supplierId) {
        setError(t.purchasing.errors.SUPPLIER_REQUIRED)
        return
      }
      setSubmitting(true)
      try {
        const res = await postCreditPurchase({
          supplier_id: supplierId,
          notes: null,
          lines: payloadLines,
        })
        void queryClient.invalidateQueries({ queryKey: posKeys.context() })
        void queryClient.invalidateQueries({ queryKey: treasuryKeys.all })
        void queryClient.invalidateQueries({
          queryKey: ['purchasing', 'ops-ingredients'],
        })
        toast.success(`${t.pos.ops.purchaseCreditDone} (${res.reference})`)
        onOpenChange(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : t.pos.errors.generic)
      } finally {
        setSubmitting(false)
      }
      return
    }

    const payTreasury = treasuryId || drawer?.id
    if (!payTreasury) {
      setError(t.purchasing.errors.NOT_FOUND)
      return
    }
    if (sourceKind === 'direct' && !directLabel.trim()) {
      setError(t.purchasing.errors.DIRECT_LABEL_REQUIRED)
      return
    }
    if (sourceKind === 'supplier' && !supplierId) {
      setError(t.purchasing.errors.SUPPLIER_REQUIRED)
      return
    }
    setSubmitting(true)
    try {
      const res = await postDirectCashPurchase({
        treasury_id: payTreasury,
        source_kind: sourceKind,
        supplier_id: sourceKind === 'supplier' ? supplierId : null,
        direct_label: sourceKind === 'direct' ? directLabel.trim() : null,
        notes: null,
        lines: payloadLines,
      })
      void queryClient.invalidateQueries({ queryKey: posKeys.context() })
      void queryClient.invalidateQueries({ queryKey: treasuryKeys.all })
      void queryClient.invalidateQueries({
        queryKey: ['purchasing', 'ops-ingredients'],
      })
      toast.success(`${t.pos.ops.purchaseDone} (${res.reference})`)
      onOpenChange(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : t.pos.errors.generic
      if (isInsufficientOperatingError(msg)) {
        setReleaseSuggest(
          payloadLines.reduce((s, l) => s + l.qty * l.unit_price, 0),
        )
        setReleaseOpen(true)
        setError(t.treasury.liquidity.insufficientHint)
      } else {
        setError(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  function pickIngredient(idx: number, ingredientId: string) {
    const ing = (ingredientsQ.data ?? []).find((i) => i.id === ingredientId)
    const next = [...lines]
    next[idx] = {
      ...lines[idx]!,
      ingredient_id: ingredientId,
      uom_id: ing?.base_uom_id ?? '',
    }
    setLines(next)
  }

  async function saveNewIngredient() {
    if (!newName.trim()) {
      setError(t.purchasing.errors.INVALID_NAME)
      return
    }
    const uomId = newUomId || uomsQ.data?.[0]?.id
    if (!uomId) {
      setError(t.purchasing.errors.INVALID_UOM)
      return
    }
    setCreating(true)
    setError(null)
    try {
      const created = await createOpsIngredient({
        name_ar: newName.trim(),
        base_uom_id: uomId,
        standard_cost: 0,
      })
      await queryClient.invalidateQueries({
        queryKey: ['purchasing', 'ops-ingredients'],
      })
      // Attach to first empty line or append
      setLines((prev) => {
        const emptyIdx = prev.findIndex((l) => !l.ingredient_id)
        const row: DraftLine = {
          key: crypto.randomUUID(),
          ingredient_id: created.id,
          uom_id: created.base_uom_id,
          qty: '1',
          unit_price: '',
        }
        if (emptyIdx >= 0) {
          const copy = [...prev]
          copy[emptyIdx] = { ...copy[emptyIdx]!, ...row, key: copy[emptyIdx]!.key }
          return copy
        }
        return [...prev, row]
      })
      setCreateOpen(false)
      setNewName('')
      toast.success(created.name_ar)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.pos.errors.generic)
    } finally {
      setCreating(false)
    }
  }

  async function submitTransfer() {
    const value = Number(xferAmount)
    if (!sourceId || !destId || !Number.isFinite(value) || value <= 0) {
      setError(t.pos.ops.invalidAmount)
      return
    }
    if (!reasonPreset) {
      setError(t.pos.ops.reasonRequired)
      return
    }
    const reason = resolveTransferReason(
      reasonPreset,
      reasonOther,
      t.pos.ops.reasonPresets,
    )
    if (!reason) {
      setError(
        reasonPreset === 'other'
          ? t.pos.ops.reasonOtherRequired
          : t.pos.ops.reasonRequired,
      )
      return
    }
    if (value > sourceAvailable + 1e-9) {
      setError(t.pos.errors.INSUFFICIENT_FUNDS)
      return
    }
    setSubmitting(true)
    try {
      await posOperationalTransfer({
        sourceTreasuryId: sourceId,
        destTreasuryId: destId,
        amount: value,
        reason,
      })
      void queryClient.invalidateQueries({ queryKey: posKeys.context() })
      toast.success(t.pos.ops.transferDone)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.pos.errors.generic)
    } finally {
      setSubmitting(false)
    }
  }

  async function submit() {
    setError(null)
    if (kind === 'expense') return submitExpense()
    if (kind === 'purchase') return submitPurchase()
    return submitTransfer()
  }

  const kinds: FinancialMoveKind[] = canOperationalPurchase
    ? ['expense', 'purchase', 'transfer']
    : ['expense', 'transfer']

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.pos.ops.financialMovement}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <Button
                key={k}
                type="button"
                size="sm"
                variant={kind === k ? 'default' : 'outline'}
                className={cn(kind === k && 'shadow-sm')}
                onClick={() => {
                  setKind(k)
                  setError(null)
                }}
              >
                {k === 'expense'
                  ? t.pos.ops.moveKindExpense
                  : k === 'purchase'
                    ? t.pos.ops.moveKindPurchase
                    : t.pos.ops.moveKindTransfer}
              </Button>
            ))}
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {kind === 'expense' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t.pos.ops.amount}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t.pos.ops.description}</Label>
                <Input
                  value={expDescription}
                  onChange={(e) => setExpDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t.pos.ops.vendor}</Label>
                <Input
                  value={expVendor}
                  onChange={(e) => setExpVendor(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {kind === 'purchase' ? (
            <div className="space-y-4">
              <p className="text-muted-foreground text-xs">
                {t.pos.ops.purchaseInventoryHint}
              </p>
              <p className="text-muted-foreground text-xs">
                {t.pos.ops.purchaseReceiveNow}
              </p>
              <div className="space-y-2">
                <Label>{t.pos.ops.purchaseSettlement}</Label>
                <div className="flex flex-wrap gap-2">
                  {(['cash', 'credit'] as const).map((s) => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant={settlement === s ? 'default' : 'outline'}
                      disabled={s === 'credit' && !canCredit}
                      onClick={() => {
                        setSettlement(s)
                        if (s === 'credit') setSourceKind('supplier')
                      }}
                    >
                      {s === 'cash'
                        ? t.pos.ops.purchaseCash
                        : t.pos.ops.purchaseCredit}
                    </Button>
                  ))}
                </div>
                {settlement === 'credit' ? (
                  <p className="text-muted-foreground text-xs">
                    {t.pos.ops.purchaseCreditHint}
                  </p>
                ) : null}
              </div>
              {settlement === 'cash' ? (
                <div className="flex flex-wrap gap-2">
                  {(['direct', 'supplier'] as const).map((sk) => (
                    <Button
                      key={sk}
                      type="button"
                      size="sm"
                      variant={sourceKind === sk ? 'default' : 'outline'}
                      onClick={() => setSourceKind(sk)}
                    >
                      {sk === 'direct'
                        ? t.pos.ops.purchaseDirect
                        : t.pos.ops.purchaseSupplier}
                    </Button>
                  ))}
                </div>
              ) : null}
              {settlement === 'cash' && sourceKind === 'direct' ? (
                <div className="space-y-2">
                  <Label>{t.pos.ops.purchaseLabel}</Label>
                  <Input
                    value={directLabel}
                    onChange={(e) => setDirectLabel(e.target.value)}
                    placeholder={t.purchasing.fields.directLabelHint}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>{t.pos.ops.purchaseSupplierPick}</Label>
                  <select
                    className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                  >
                    <option value="">—</option>
                    {(suppliersQ.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name_ar}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {settlement === 'cash' ? (
                <div className="space-y-2">
                  <Label>{t.pos.ops.purchaseTreasury}</Label>
                  <select
                    className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                    value={treasuryId || drawer?.id || ''}
                    onChange={(e) => setTreasuryId(e.target.value)}
                  >
                    {treasuries.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.name} ({formatMoney(transferableAmount(tr))})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {ingredientsQ.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t.pos.ops.purchaseIngredientsLoadError}
                  </AlertDescription>
                </Alert>
              ) : null}
              {!ingredientsQ.isLoading &&
              (ingredientsQ.data?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t.pos.ops.purchaseIngredientsEmpty}
                </p>
              ) : null}

              {lines.map((line, idx) => {
                const selected = (ingredientsQ.data ?? []).find(
                  (i) => i.id === line.ingredient_id,
                ) as OpsIngredient | undefined
                return (
                  <div
                    key={line.key}
                    className="border-border space-y-2 rounded border p-3"
                  >
                    <div className="space-y-2">
                      <Label>{t.pos.ops.purchaseIngredient}</Label>
                      <select
                        className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                        value={line.ingredient_id}
                        onChange={(e) => pickIngredient(idx, e.target.value)}
                      >
                        <option value="">
                          {t.pos.ops.purchasePickIngredient}
                        </option>
                        {(ingredientsQ.data ?? []).map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name_ar}
                            {i.base_uom_code ? ` (${i.base_uom_code})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-2">
                        <Label>{t.pos.ops.purchaseQty}</Label>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={line.qty}
                          onChange={(e) => {
                            const next = [...lines]
                            next[idx] = { ...line, qty: e.target.value }
                            setLines(next)
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t.pos.ops.purchaseUom}</Label>
                        <select
                          className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                          value={line.uom_id || selected?.base_uom_id || ''}
                          onChange={(e) => {
                            const next = [...lines]
                            next[idx] = { ...line, uom_id: e.target.value }
                            setLines(next)
                          }}
                        >
                          {(uomsQ.data ?? []).map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name_ar} ({u.code})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label>{t.pos.ops.purchaseUnitPrice}</Label>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          placeholder="0.00"
                          value={line.unit_price}
                          onChange={(e) => {
                            const next = [...lines]
                            next[idx] = { ...line, unit_price: e.target.value }
                            setLines(next)
                          }}
                        />
                      </div>
                    </div>
                    {lines.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setLines(lines.filter((l) => l.key !== line.key))
                        }
                      >
                        {t.purchasing.actions.removeLine}
                      </Button>
                    ) : null}
                  </div>
                )
              })}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLines([
                      ...lines,
                      {
                        key: crypto.randomUUID(),
                        ingredient_id: '',
                        uom_id: '',
                        qty: '1',
                        unit_price: '',
                      },
                    ])
                  }
                >
                  {t.pos.ops.purchaseAddLine}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCreateOpen((v) => !v)
                    if (!newUomId && uomsQ.data?.[0]?.id) {
                      setNewUomId(uomsQ.data[0].id)
                    }
                  }}
                >
                  {t.pos.ops.purchaseCreateIngredient}
                </Button>
              </div>

              {createOpen ? (
                <div className="border-border space-y-2 rounded border border-dashed p-3">
                  <p className="text-sm font-medium">
                    {t.pos.ops.purchaseCreateIngredientTitle}
                  </p>
                  <div className="space-y-2">
                    <Label>{t.pos.ops.purchaseCreateIngredientName}</Label>
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="طماطم / جبنة / أكياس…"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t.pos.ops.purchaseUom}</Label>
                    <select
                      className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                      value={newUomId}
                      onChange={(e) => setNewUomId(e.target.value)}
                    >
                      {(uomsQ.data ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name_ar} ({u.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      loading={creating}
                      onClick={() => void saveNewIngredient()}
                    >
                      {t.pos.ops.purchaseCreateIngredientSave}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setCreateOpen(false)}
                    >
                      {t.pos.ops.purchaseCreateIngredientCancel}
                    </Button>
                  </div>
                </div>
              ) : null}

              <p className="text-sm font-medium">
                {t.pos.ops.purchaseTotal}: {formatMoney(purchaseTotal)}
              </p>
            </div>
          ) : null}

          {kind === 'transfer' ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t.pos.ops.from}</Label>
                <select
                  className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                  value={sourceId}
                  onChange={(e) => {
                    setSourceId(e.target.value)
                    const nextSource = treasuries.find(
                      (tr) => tr.id === e.target.value,
                    )
                    if (nextSource?.code === 'drawer') {
                      setDestId(digitals[0]?.id ?? '')
                    } else if (drawer) {
                      setDestId(drawer.id)
                    }
                  }}
                >
                  {treasuries.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.name} ({formatMoney(transferableAmount(tr))})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>{t.pos.ops.to}</Label>
                <select
                  className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                  value={destId}
                  onChange={(e) => setDestId(e.target.value)}
                >
                  {destOptions.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.name} ({formatMoney(transferableAmount(tr))})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>{t.pos.ops.amount}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  dir="ltr"
                  value={xferAmount}
                  onChange={(e) => setXferAmount(e.target.value)}
                />
                {source ? (
                  <p className="text-muted-foreground text-xs">
                    {source.code === 'drawer'
                      ? t.pos.ops.drawerBalance
                      : t.pos.ops.available}
                    : {formatMoney(sourceAvailable)}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>{t.pos.ops.reason}</Label>
                <select
                  className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                  value={reasonPreset}
                  onChange={(e) =>
                    setReasonPreset(e.target.value as TransferReasonPreset | '')
                  }
                >
                  <option value="">—</option>
                  {TRANSFER_REASON_PRESETS.map((key) => (
                    <option key={key} value={key}>
                      {t.pos.ops.reasonPresets[key]}
                    </option>
                  ))}
                </select>
                {reasonPreset === 'other' ? (
                  <Input
                    value={reasonOther}
                    onChange={(e) => setReasonOther(e.target.value)}
                    placeholder={t.pos.ops.reasonOtherRequired}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            loading={submitting}
            onClick={() => void submit()}
          >
            {t.common.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <ReleaseReservedDialog
      open={releaseOpen}
      onOpenChange={setReleaseOpen}
      suggestedAmount={releaseSuggest}
    />
    </>
  )
}
