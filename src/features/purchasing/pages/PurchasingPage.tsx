import { formatDateTime } from '@/features/treasury/utils/format'
import { useTreasuries } from '@/features/treasury/hooks/useTreasuryQueries'
import { useIngredients } from '@/features/recipes/hooks/useRecipesQueries'
import {
  usePostCreditPurchase,
  usePostDirectCashPurchase,
  usePostSupplierPayment,
  usePurchases,
  useReverseCreditPurchase,
  useReverseDirectCashPurchase,
  useReverseSupplierPayment,
  useSetSupplierActive,
  useSupplierBalance,
  useSupplierPayments,
  useSupplierStatement,
  useSuppliers,
  useUpsertSupplier,
} from '@/features/purchasing/hooks/usePurchasingQueries'
import type {
  PurchaseSettlement,
  PurchaseSourceKind,
} from '@/features/purchasing/types'
import {
  isInsufficientOperatingError,
  ReleaseReservedDialog,
} from '@/features/treasury/components/dialogs/ReleaseReservedDialog'
import { usePermissions } from '@/shared/access/permissions'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { ErrorState } from '@/shared/components/patterns/ErrorState'
import { LoadingState } from '@/shared/components/patterns/LoadingState'
import { PageHeader } from '@/shared/components/patterns/PageHeader'
import { cn } from '@/shared/utils/cn'
import { t } from '@/shared/i18n'
import { toast } from 'sonner'
import { useMemo, useState, type ReactNode } from 'react'

const TABS = ['purchases', 'buy', 'suppliers'] as const
type Tab = (typeof TABS)[number]

type DraftLine = {
  key: string
  ingredient_id: string
  qty: string
  unit_price: string
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export function PurchasingPage() {
  const [tab, setTab] = useState<Tab>('buy')

  return (
    <div className="space-y-6">
      <PageHeader title={t.purchasing.title} description={t.purchasing.subtitle} />
      <p className="text-muted-foreground text-sm">{t.purchasing.hint.cashOnly}</p>
      <p className="text-muted-foreground text-sm">{t.purchasing.hint.notExpense}</p>
      <div role="tablist" className="border-border flex flex-wrap gap-1 border-b">
        {TABS.map((value) => (
          <Button
            key={value}
            role="tab"
            aria-selected={tab === value}
            variant="ghost"
            className={cn(
              'rounded-none border-b-2 border-transparent',
              tab === value && 'border-primary text-primary',
            )}
            onClick={() => setTab(value)}
          >
            {t.purchasing.tabs[value]}
          </Button>
        ))}
      </div>
      {tab === 'purchases' ? <PurchasesTab /> : null}
      {tab === 'buy' ? (
        <BuyTab onPosted={() => setTab('purchases')} />
      ) : null}
      {tab === 'suppliers' ? <SuppliersTab /> : null}
    </div>
  )
}

function PurchasesTab() {
  const q = usePurchases()
  const reverseCash = useReverseDirectCashPurchase()
  const reverseCredit = useReverseCreditPurchase()

  if (q.isLoading) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        description={
          q.error instanceof Error ? q.error.message : t.purchasing.errors.generic
        }
        onRetry={() => void q.refetch()}
      />
    )

  const rows = q.data ?? []
  if (rows.length === 0)
    return <p className="text-muted-foreground">{t.purchasing.empty.purchases}</p>

  return (
    <div className="space-y-4">
      {rows.map((p) => {
        const isCredit = p.payment_method === 'credit'
        const reverse = isCredit ? reverseCredit : reverseCash
        return (
          <Card key={p.id}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-base">
                {p.reference} · {money(Number(p.total_amount))} ج.م
              </CardTitle>
              <span className="text-muted-foreground text-sm">
                {t.purchasing.settlement[p.payment_method] ?? p.payment_method}
                {' · '}
                {t.purchasing.status[p.status] ?? p.status}
              </span>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                {p.source_kind === 'direct'
                  ? `${t.purchasing.source.direct}: ${p.direct_label}`
                  : `${t.purchasing.source.supplier}: ${p.supplier_name_ar ?? '—'}`}
              </div>
              <div className="text-muted-foreground">
                {isCredit
                  ? t.purchasing.hint.creditNoTreasury
                  : (p.treasury_name ?? '—')}
                {' · '}
                {formatDateTime(p.created_at)}
              </div>
              <ul className="border-border divide-y rounded border">
                {(p.lines ?? []).map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap justify-between gap-2 px-3 py-2"
                  >
                    <span>{l.ingredient_name_ar ?? l.ingredient_id}</span>
                    <span>
                      {l.qty} × {money(Number(l.unit_price))} ={' '}
                      {money(Number(l.line_total))}
                    </span>
                  </li>
                ))}
              </ul>
              {p.status === 'executed' ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={reverse.isPending}
                  onClick={() => {
                    const confirmMsg = isCredit
                      ? t.purchasing.confirm.reverseCredit
                      : t.purchasing.confirm.reverseCash
                    if (!window.confirm(confirmMsg)) return
                    const reason = window.prompt(t.purchasing.fields.reverseReason)
                    if (!reason?.trim()) {
                      toast.error(t.purchasing.errors.REASON_REQUIRED)
                      return
                    }
                    reverse.mutate(
                      { id: p.id, reason: reason.trim() },
                      {
                        onSuccess: () =>
                          toast.success(t.purchasing.success.reversed),
                        onError: (e) =>
                          toast.error(
                            e instanceof Error
                              ? e.message
                              : t.purchasing.errors.generic,
                          ),
                      },
                    )
                  }}
                >
                  {t.purchasing.actions.reverse}
                </Button>
              ) : null}
              {p.reversal_reason ? (
                <p className="text-muted-foreground">
                  {t.purchasing.fields.reverseReason}: {p.reversal_reason}
                </p>
              ) : null}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function BuyTab({ onPosted }: { onPosted: () => void }) {
  const { can } = usePermissions()
  const canCredit = can('purchase.credit.create')
  const ingredients = useIngredients()
  const treasuries = useTreasuries()
  const suppliers = useSuppliers(true)
  const postCash = usePostDirectCashPurchase()
  const postCredit = usePostCreditPurchase()

  const [settlement, setSettlement] = useState<PurchaseSettlement>('cash')
  const [sourceKind, setSourceKind] = useState<PurchaseSourceKind>('direct')
  const [directLabel, setDirectLabel] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [treasuryId, setTreasuryId] = useState('')
  const [notes, setNotes] = useState('')
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releaseSuggest, setReleaseSuggest] = useState<number | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([
    { key: crypto.randomUUID(), ingredient_id: '', qty: '1', unit_price: '0' },
  ])

  const cashTreasuries = useMemo(
    () =>
      (treasuries.data ?? []).filter(
        (tr) => tr.is_active && tr.type === 'cash' && !tr.is_shift_drawer,
      ),
    [treasuries.data],
  )

  const effectiveTreasury =
    treasuryId || cashTreasuries[0]?.id || treasuries.data?.[0]?.id || ''

  const total = lines.reduce((sum, line) => {
    const qty = Number(line.qty)
    const price = Number(line.unit_price)
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return sum
    return sum + qty * price
  }, 0)

  const pending = postCash.isPending || postCredit.isPending

  if (ingredients.isLoading || treasuries.isLoading) return <LoadingState />

  function buildPayloadLines() {
    return lines
      .map((line) => {
        const ing = (ingredients.data ?? []).find(
          (i) => i.id === line.ingredient_id,
        )
        return {
          ingredient_id: line.ingredient_id,
          qty: Number(line.qty),
          uom_id: ing?.base_uom_id ?? '',
          unit_price: Number(line.unit_price),
        }
      })
      .filter(
        (l) =>
          l.ingredient_id &&
          l.uom_id &&
          Number.isFinite(l.qty) &&
          l.qty > 0 &&
          Number.isFinite(l.unit_price) &&
          l.unit_price >= 0,
      )
  }

  function resetForm() {
    setDirectLabel('')
    setNotes('')
    setLines([
      {
        key: crypto.randomUUID(),
        ingredient_id: '',
        qty: '1',
        unit_price: '0',
      },
    ])
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.purchasing.tabs.buy}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label={t.purchasing.fields.settlement}>
          <div className="flex flex-wrap gap-2">
            {(['cash', 'credit'] as const).map((s) => (
              <Button
                key={s}
                type="button"
                variant={settlement === s ? 'default' : 'outline'}
                size="sm"
                disabled={s === 'credit' && !canCredit}
                onClick={() => {
                  setSettlement(s)
                  if (s === 'credit') setSourceKind('supplier')
                }}
              >
                {t.purchasing.settlement[s]}
              </Button>
            ))}
          </div>
          {settlement === 'credit' ? (
            <p className="text-muted-foreground text-xs">
              {t.purchasing.hint.creditRequiresSupplier}
            </p>
          ) : null}
        </Field>

        {settlement === 'cash' ? (
          <Field label={t.purchasing.fields.source}>
            <div className="flex flex-wrap gap-2">
              {(['direct', 'supplier'] as const).map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  variant={sourceKind === kind ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSourceKind(kind)}
                >
                  {t.purchasing.source[kind]}
                </Button>
              ))}
            </div>
          </Field>
        ) : null}

        {settlement === 'cash' && sourceKind === 'direct' ? (
          <Field label={t.purchasing.fields.directLabel}>
            <Input
              value={directLabel}
              onChange={(e) => setDirectLabel(e.target.value)}
              placeholder={t.purchasing.fields.directLabelHint}
            />
          </Field>
        ) : (
          <Field label={t.purchasing.fields.supplier}>
            <select
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">—</option>
              {(suppliers.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_ar}
                </option>
              ))}
            </select>
          </Field>
        )}

        {settlement === 'cash' ? (
          <Field label={t.purchasing.fields.treasury}>
            <select
              className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              value={effectiveTreasury}
              onChange={(e) => setTreasuryId(e.target.value)}
            >
              {(cashTreasuries.length > 0
                ? cashTreasuries
                : (treasuries.data ?? []).filter((tr) => tr.is_active)
              ).map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.name}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t.purchasing.hint.creditNoTreasury}
          </p>
        )}

        <div className="space-y-3">
          {lines.map((line, idx) => {
            const ing = (ingredients.data ?? []).find(
              (i) => i.id === line.ingredient_id,
            )
            return (
              <div
                key={line.key}
                className="border-border grid gap-2 rounded border p-3 md:grid-cols-4"
              >
                <Field label={t.purchasing.fields.ingredient}>
                  <select
                    className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                    value={line.ingredient_id}
                    onChange={(e) => {
                      const next = [...lines]
                      next[idx] = { ...line, ingredient_id: e.target.value }
                      setLines(next)
                    }}
                  >
                    <option value="">—</option>
                    {(ingredients.data ?? [])
                      .filter((i) => i.is_active)
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name_ar}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label={t.purchasing.fields.qty}>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={line.qty}
                    onChange={(e) => {
                      const next = [...lines]
                      next[idx] = { ...line, qty: e.target.value }
                      setLines(next)
                    }}
                  />
                  {ing ? (
                    <span className="text-muted-foreground text-xs">
                      {ing.base_uom_code ?? ''}
                    </span>
                  ) : null}
                </Field>
                <Field label={t.purchasing.fields.unitPrice}>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={line.unit_price}
                    onChange={(e) => {
                      const next = [...lines]
                      next[idx] = { ...line, unit_price: e.target.value }
                      setLines(next)
                    }}
                  />
                </Field>
                <div className="flex items-end gap-2">
                  <div className="text-sm">
                    {t.purchasing.fields.lineTotal}:{' '}
                    {money(
                      (Number(line.qty) || 0) * (Number(line.unit_price) || 0),
                    )}
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
              </div>
            )
          })}
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
                  qty: '1',
                  unit_price: '0',
                },
              ])
            }
          >
            {t.purchasing.actions.addLine}
          </Button>
        </div>

        <Field label={t.purchasing.fields.notes}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-lg font-medium">
            {t.purchasing.fields.total}: {money(total)} ج.م
          </div>
          <Button
            disabled={pending}
            onClick={() => {
              const payloadLines = buildPayloadLines()
              if (payloadLines.length === 0) {
                toast.error(t.purchasing.empty.lines)
                return
              }

              if (settlement === 'credit') {
                if (!canCredit) {
                  toast.error(t.purchasing.errors.PERMISSION_DENIED)
                  return
                }
                if (!supplierId) {
                  toast.error(t.purchasing.errors.SUPPLIER_REQUIRED)
                  return
                }
                postCredit.mutate(
                  {
                    supplier_id: supplierId,
                    notes: notes.trim() || null,
                    lines: payloadLines,
                  },
                  {
                    onSuccess: (res) => {
                      toast.success(
                        `${t.purchasing.success.postedCredit} (${res.reference})`,
                      )
                      resetForm()
                      onPosted()
                    },
                    onError: (e) =>
                      toast.error(
                        e instanceof Error
                          ? e.message
                          : t.purchasing.errors.generic,
                      ),
                  },
                )
                return
              }

              if (!effectiveTreasury) {
                toast.error(t.purchasing.errors.NOT_FOUND)
                return
              }
              if (sourceKind === 'direct' && !directLabel.trim()) {
                toast.error(t.purchasing.errors.DIRECT_LABEL_REQUIRED)
                return
              }
              if (sourceKind === 'supplier' && !supplierId) {
                toast.error(t.purchasing.errors.SUPPLIER_REQUIRED)
                return
              }

              postCash.mutate(
                {
                  treasury_id: effectiveTreasury,
                  source_kind: sourceKind,
                  supplier_id: sourceKind === 'supplier' ? supplierId : null,
                  direct_label:
                    sourceKind === 'direct' ? directLabel.trim() : null,
                  notes: notes.trim() || null,
                  lines: payloadLines,
                },
                {
                  onSuccess: (res) => {
                    toast.success(
                      `${t.purchasing.success.posted} (${res.reference})`,
                    )
                    resetForm()
                    onPosted()
                  },
                  onError: (e) => {
                    const msg =
                      e instanceof Error
                        ? e.message
                        : t.purchasing.errors.generic
                    if (isInsufficientOperatingError(msg)) {
                      setReleaseSuggest(total)
                      setReleaseOpen(true)
                      toast.error(t.treasury.liquidity.insufficientHint)
                      return
                    }
                    toast.error(msg)
                  },
                },
              )
            }}
          >
            {settlement === 'credit'
              ? t.purchasing.actions.postCredit
              : t.purchasing.actions.post}
          </Button>
        </div>
      </CardContent>
      <ReleaseReservedDialog
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        suggestedAmount={releaseSuggest}
      />
    </Card>
  )
}

function SuppliersTab() {
  const { can } = usePermissions()
  const canPay = can('purchase.supplier.pay')
  const q = useSuppliers(false)
  const upsert = useUpsertSupplier()
  const setActive = useSetSupplierActive()
  const treasuries = useTreasuries()
  const [nameAr, setNameAr] = useState('')
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [ledgerId, setLedgerId] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payTreasuryId, setPayTreasuryId] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [payReleaseOpen, setPayReleaseOpen] = useState(false)
  const [payReleaseSuggest, setPayReleaseSuggest] = useState<number | null>(null)

  const balanceQ = useSupplierBalance(ledgerId)
  const statementQ = useSupplierStatement(ledgerId)
  const paymentsQ = useSupplierPayments(ledgerId)
  const postPay = usePostSupplierPayment()
  const reversePay = useReverseSupplierPayment()

  const cashTreasuries = useMemo(
    () =>
      (treasuries.data ?? []).filter(
        (tr) => tr.is_active && tr.type === 'cash' && !tr.is_shift_drawer,
      ),
    [treasuries.data],
  )
  const effectivePayTreasury =
    payTreasuryId || cashTreasuries[0]?.id || treasuries.data?.[0]?.id || ''

  if (q.isLoading) return <LoadingState />
  if (q.isError)
    return (
      <ErrorState
        description={
          q.error instanceof Error ? q.error.message : t.purchasing.errors.generic
        }
        onRetry={() => void q.refetch()}
      />
    )

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              {editId
                ? t.purchasing.actions.saveSupplier
                : t.purchasing.actions.newSupplier}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label={t.purchasing.fields.nameAr}>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </Field>
            <Field label={t.purchasing.fields.code}>
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label={t.purchasing.fields.phone}>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label={t.purchasing.fields.notes}>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button
                disabled={upsert.isPending}
                onClick={() => {
                  if (!nameAr.trim()) {
                    toast.error(t.purchasing.errors.INVALID_NAME)
                    return
                  }
                  upsert.mutate(
                    {
                      id: editId,
                      name_ar: nameAr.trim(),
                      code: code.trim() || null,
                      phone: phone.trim() || null,
                      notes: notes.trim() || null,
                    },
                    {
                      onSuccess: () => {
                        toast.success(t.purchasing.success.supplierSaved)
                        setEditId(null)
                        setNameAr('')
                        setCode('')
                        setPhone('')
                        setNotes('')
                      },
                      onError: (e) =>
                        toast.error(
                          e instanceof Error
                            ? e.message
                            : t.purchasing.errors.generic,
                        ),
                    },
                  )
                }}
              >
                {t.purchasing.actions.saveSupplier}
              </Button>
              {editId ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditId(null)
                    setNameAr('')
                    setCode('')
                    setPhone('')
                    setNotes('')
                  }}
                >
                  {t.purchasing.actions.newSupplier}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-2">
          {(q.data ?? []).length === 0 ? (
            <p className="text-muted-foreground">{t.purchasing.empty.suppliers}</p>
          ) : (
            (q.data ?? []).map((s) => (
              <Card key={s.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4">
                  <div>
                    <div className="font-medium">
                      {s.name_ar}
                      {!s.is_active ? (
                        <span className="text-muted-foreground text-sm">
                          {' '}
                          (معطّل)
                        </span>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground text-sm">
                      {[s.code, s.phone].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={ledgerId === s.id ? 'default' : 'outline'}
                      onClick={() => setLedgerId(s.id)}
                    >
                      {t.purchasing.actions.viewStatement}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditId(s.id)
                        setNameAr(s.name_ar)
                        setCode(s.code ?? '')
                        setPhone(s.phone ?? '')
                        setNotes(s.notes ?? '')
                      }}
                    >
                      {t.purchasing.actions.saveSupplier}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={setActive.isPending}
                      onClick={() =>
                        setActive.mutate({ id: s.id, active: !s.is_active })
                      }
                    >
                      {s.is_active
                        ? t.purchasing.actions.deactivate
                        : t.purchasing.actions.activate}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {ledgerId ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">
              {t.purchasing.fields.statement}
              {balanceQ.data
                ? ` · ${balanceQ.data.supplier_name_ar}`
                : ''}
            </CardTitle>
            <div className="text-sm font-medium">
              {t.purchasing.fields.openBalance}:{' '}
              {balanceQ.data
                ? `${money(Number(balanceQ.data.open_balance))} ج.م`
                : '…'}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {canPay ? (
              <div className="border-border grid gap-3 rounded border p-3 md:grid-cols-4">
                <Field label={t.purchasing.fields.payAmount}>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                </Field>
                <Field label={t.purchasing.fields.paymentTreasury}>
                  <select
                    className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
                    value={effectivePayTreasury}
                    onChange={(e) => setPayTreasuryId(e.target.value)}
                  >
                    {(cashTreasuries.length > 0
                      ? cashTreasuries
                      : (treasuries.data ?? []).filter((tr) => tr.is_active)
                    ).map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t.purchasing.fields.notes}>
                  <Input
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    disabled={postPay.isPending}
                    onClick={() => {
                      const amount = Number(payAmount)
                      if (!Number.isFinite(amount) || amount <= 0) {
                        toast.error(t.purchasing.errors.INVALID_AMOUNT)
                        return
                      }
                      if (!effectivePayTreasury) {
                        toast.error(t.purchasing.errors.NOT_FOUND)
                        return
                      }
                      postPay.mutate(
                        {
                          supplier_id: ledgerId,
                          treasury_id: effectivePayTreasury,
                          amount,
                          notes: payNotes.trim() || null,
                        },
                        {
                          onSuccess: (res) => {
                            toast.success(
                              `${t.purchasing.success.paid} (${res.reference})`,
                            )
                            setPayAmount('')
                            setPayNotes('')
                          },
                          onError: (e) => {
                            const msg =
                              e instanceof Error
                                ? e.message
                                : t.purchasing.errors.generic
                            if (isInsufficientOperatingError(msg)) {
                              setPayReleaseOpen(true)
                              setPayReleaseSuggest(amount)
                              toast.error(t.treasury.liquidity.insufficientHint)
                              return
                            }
                            toast.error(msg)
                          },
                        },
                      )
                    }}
                  >
                    {t.purchasing.actions.paySupplier}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                {t.purchasing.fields.statement}
              </h3>
              {statementQ.isLoading ? (
                <LoadingState />
              ) : (statementQ.data?.entries?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t.purchasing.empty.statement}
                </p>
              ) : (
                <div className="border-border overflow-x-auto rounded border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-start">التاريخ</th>
                        <th className="px-3 py-2 text-start">البيان</th>
                        <th className="px-3 py-2 text-start">المرجع</th>
                        <th className="px-3 py-2 text-end">
                          {t.purchasing.fields.debit}
                        </th>
                        <th className="px-3 py-2 text-end">
                          {t.purchasing.fields.credit}
                        </th>
                        <th className="px-3 py-2 text-end">
                          {t.purchasing.fields.running}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(statementQ.data?.entries ?? []).map((e) => (
                        <tr key={`${e.kind}-${e.doc_id}-${e.at}`}>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {formatDateTime(e.at)}
                          </td>
                          <td className="px-3 py-2">{e.label_ar}</td>
                          <td className="px-3 py-2">{e.reference}</td>
                          <td className="px-3 py-2 text-end">
                            {Number(e.debit) > 0 ? money(Number(e.debit)) : '—'}
                          </td>
                          <td className="px-3 py-2 text-end">
                            {Number(e.credit) > 0
                              ? money(Number(e.credit))
                              : '—'}
                          </td>
                          <td className="px-3 py-2 text-end">
                            {money(Number(e.running_balance))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                {t.purchasing.actions.paySupplier}
              </h3>
              {(paymentsQ.data ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t.purchasing.empty.payments}
                </p>
              ) : (
                <ul className="space-y-2">
                  {(paymentsQ.data ?? []).map((pay) => (
                    <li
                      key={pay.id}
                      className="border-border flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
                    >
                      <div>
                        <div className="font-medium">
                          {pay.reference} · {money(Number(pay.amount))} ج.م
                        </div>
                        <div className="text-muted-foreground">
                          {pay.treasury_name} ·{' '}
                          {t.purchasing.status[pay.status] ?? pay.status}
                          {pay.executed_at
                            ? ` · ${formatDateTime(pay.executed_at)}`
                            : ''}
                        </div>
                      </div>
                      {pay.status === 'executed' && canPay ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reversePay.isPending}
                          onClick={() => {
                            if (!window.confirm(t.purchasing.confirm.reversePayment))
                              return
                            const reason = window.prompt(
                              t.purchasing.fields.reverseReason,
                            )
                            if (!reason?.trim()) {
                              toast.error(t.purchasing.errors.REASON_REQUIRED)
                              return
                            }
                            reversePay.mutate(
                              { id: pay.id, reason: reason.trim() },
                              {
                                onSuccess: () =>
                                  toast.success(
                                    t.purchasing.success.paymentReversed,
                                  ),
                                onError: (e) =>
                                  toast.error(
                                    e instanceof Error
                                      ? e.message
                                      : t.purchasing.errors.generic,
                                  ),
                              },
                            )
                          }}
                        >
                          {t.purchasing.actions.reversePayment}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <ReleaseReservedDialog
        open={payReleaseOpen}
        onOpenChange={setPayReleaseOpen}
        suggestedAmount={payReleaseSuggest}
      />
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
