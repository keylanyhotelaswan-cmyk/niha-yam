import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'
import type {
  AdjustmentRow,
  CreateAdjustmentInput,
  CreateExpenseInput,
  CreateTransferInput,
  ExpenseRow,
  LedgerEntry,
  OpenShift,
  PaymentMethodRow,
  TransferRow,
  TreasuryBalance,
  TreasuryRow,
  UpsertTreasuryInput,
} from '@/features/treasury/types'

type ErrorCode = keyof typeof t.treasury.errors

/** RPC errors surface the code inside the message; map to Arabic copy. */
function rpcErrorMessage(message: string): string {
  const code = (Object.keys(t.treasury.errors) as ErrorCode[]).find(
    (c) => c !== 'generic' && message.includes(c),
  )
  return code ? t.treasury.errors[code] : t.treasury.errors.generic
}

function wrap(error: { message: string }): Error {
  return new Error(rpcErrorMessage(error.message))
}

/** Untyped RPC bridge for OES handover functions not yet in generated types. */
const rpcLoose = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as (
      name: string,
      args?: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )(fn, args)

// Reads --------------------------------------------------------------------
export async function fetchBalances(): Promise<TreasuryBalance[]> {
  const { data, error } = await supabase.rpc('get_treasury_balances')
  if (error) throw error
  return (data as unknown as TreasuryBalance[]) ?? []
}

export async function fetchOpenShift(): Promise<OpenShift | null> {
  const { data, error } = await supabase.rpc('get_open_shift')
  if (error) throw error
  return (data as unknown as OpenShift | null) ?? null
}

export async function fetchLedger(
  treasuryId: string,
  limit = 100,
): Promise<LedgerEntry[]> {
  const { data, error } = await supabase.rpc('get_treasury_ledger', {
    p_treasury_id: treasuryId,
    p_limit: limit,
  })
  if (error) throw error
  return (data as unknown as LedgerEntry[]) ?? []
}

export async function fetchTreasuries(): Promise<TreasuryRow[]> {
  const { data, error } = await supabase
    .from('treasuries')
    .select('*')
    .order('sort_order')
    .order('name')
  if (error) throw error
  return data ?? []
}

export async function fetchPaymentMethods(): Promise<PaymentMethodRow[]> {
  const { data, error } = await supabase
    .from('payment_methods')
    .select('*')
    .order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function fetchTransfers(): Promise<TransferRow[]> {
  const { data, error } = await supabase
    .from('treasury_transfers')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data ?? []
}

export async function fetchExpenses(): Promise<ExpenseRow[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data ?? []
}

export async function fetchAdjustments(): Promise<AdjustmentRow[]> {
  const { data, error } = await supabase
    .from('treasury_adjustments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return data ?? []
}

// Shift --------------------------------------------------------------------
export type CloseShiftResult = {
  shift_id: string
  handover_id: string
  reference: string
  kind: 'to_main' | 'to_next_shift'
  amount: number
  cashier_name: string
  status: string
}

export type PendingHandover = {
  id: string
  reference: string
  shift_id: string
  shift_reference: string
  kind: 'to_main' | 'to_next_shift'
  amount: number
  status: string
  created_at: string
  cashier_name: string | null
  created_by: string | null
  /** Closed shift cash count (if recorded). */
  actual_cash_count?: number | null
  /** Variance movement total on source shift (info only — not part of trust). */
  source_variance?: number | null
  source_expected_cash?: number | null
}

export async function openShift(
  openingFloat: number,
  receiveHandoverId?: string | null,
  receivedActualCash?: number | null,
): Promise<void> {
  const { error } = await rpcLoose('open_shift', {
    p_opening_float: openingFloat,
    p_receive_handover_id: receiveHandoverId ?? null,
    p_received_actual_cash: receivedActualCash ?? null,
  })
  if (error) throw wrap(error)
}

export async function closeShift(input: {
  actualCashCount: number
  differenceReason: string | null
  notes: string | null
  destination: 'to_main' | 'to_next_shift'
}): Promise<CloseShiftResult> {
  const { data, error } = await rpcLoose('close_shift', {
    p_actual_cash_count: input.actualCashCount,
    p_difference_reason: input.differenceReason,
    p_notes: input.notes,
    p_destination: input.destination,
  })
  if (error) throw wrap(error)
  return data as CloseShiftResult
}

export async function fetchPendingHandovers(): Promise<PendingHandover[]> {
  const { data, error } = await rpcLoose('list_pending_handovers')
  if (error) throw error
  return (data as PendingHandover[]) ?? []
}

export async function receiveTreasuryHandover(id: string): Promise<void> {
  const { error } = await rpcLoose('receive_treasury_handover', { p_id: id })
  if (error) throw wrap(error)
}

export async function rejectShiftHandover(
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await rpcLoose('reject_shift_handover', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

export async function recreateShiftHandover(
  shiftId: string,
  destination: 'to_main' | 'to_next_shift',
): Promise<void> {
  const { error } = await rpcLoose('recreate_shift_handover', {
    p_shift_id: shiftId,
    p_destination: destination,
  })
  if (error) throw wrap(error)
}

export async function fetchShiftsArchive(limit = 50) {
  const { data, error } = await rpcLoose('list_shifts_archive', {
    p_limit: limit,
  })
  if (error) throw error
  return (data as import('@/features/treasury/types').ShiftArchiveListItem[]) ?? []
}

export async function fetchShiftArchive(shiftId: string) {
  const { data, error } = await rpcLoose('get_shift_archive', {
    p_shift_id: shiftId,
  })
  if (error) throw error
  return data as import('@/features/treasury/types').ShiftArchiveDetail
}

export async function cashDrop(
  amount: number,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('cash_drop', {
    p_amount: amount,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

// Transfers ----------------------------------------------------------------
export async function createTransfer(
  input: CreateTransferInput,
): Promise<void> {
  const { error } = await supabase.rpc('create_transfer', {
    p_source_treasury_id: input.sourceTreasuryId,
    p_dest_treasury_id: input.destTreasuryId,
    p_amount: input.amount,
    p_reason: input.reason,
  })
  if (error) throw wrap(error)
}

export async function approveTransfer(id: string): Promise<void> {
  const { error } = await supabase.rpc('approve_transfer', { p_id: id })
  if (error) throw wrap(error)
}

export async function rejectTransfer(
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('reject_transfer', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

export async function reverseTransfer(
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('reverse_transfer', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

// Expenses -----------------------------------------------------------------
export async function createExpense(input: CreateExpenseInput): Promise<void> {
  const { error } = await supabase.rpc('create_expense', {
    p_treasury_id: input.treasuryId,
    p_category: input.category,
    p_amount: input.amount,
    p_description: input.description,
    p_vendor: input.vendor,
  })
  if (error) throw wrap(error)
}

export async function approveExpense(id: string): Promise<void> {
  const { error } = await supabase.rpc('approve_expense', { p_id: id })
  if (error) throw wrap(error)
}

export async function rejectExpense(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reject_expense', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

export async function reverseExpense(
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('reverse_expense', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

// Adjustments (deposit / withdrawal) ---------------------------------------
export async function createAdjustment(
  input: CreateAdjustmentInput,
): Promise<void> {
  const { error } = await supabase.rpc('create_adjustment', {
    p_treasury_id: input.treasuryId,
    p_kind: input.kind,
    p_amount: input.amount,
    p_reason: input.reason,
  })
  if (error) throw wrap(error)
}

export async function approveAdjustment(id: string): Promise<void> {
  const { error } = await supabase.rpc('approve_adjustment', { p_id: id })
  if (error) throw wrap(error)
}

export async function rejectAdjustment(
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('reject_adjustment', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

export async function reverseAdjustment(
  id: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('reverse_adjustment', {
    p_id: id,
    p_reason: reason,
  })
  if (error) throw wrap(error)
}

// Settings: treasuries + payment method mapping ----------------------------
export async function upsertTreasury(
  input: UpsertTreasuryInput,
): Promise<void> {
  if (input.id) {
    const { error } = await supabase.rpc('update_treasury', {
      p_id: input.id,
      p_name: input.name,
      p_sort_order: input.sortOrder,
    })
    if (error) throw wrap(error)
    return
  }
  const { error } = await supabase.rpc('create_treasury', {
    p_name: input.name,
    p_type: input.type,
    p_sort_order: input.sortOrder,
  })
  if (error) throw wrap(error)
}

export async function setTreasuryStatus(
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_treasury_status', {
    p_id: id,
    p_active: active,
  })
  if (error) throw wrap(error)
}

export async function setPaymentMethodMapping(
  id: string,
  treasuryId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_payment_method_mapping', {
    p_id: id,
    p_treasury_id: treasuryId,
  })
  if (error) throw wrap(error)
}

export async function setPaymentMethodStatus(
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_payment_method_status', {
    p_id: id,
    p_active: active,
  })
  if (error) throw wrap(error)
}
