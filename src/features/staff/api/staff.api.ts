import { supabase } from '@/lib/supabase/client'
import { t } from '@/shared/i18n'
import { parseDiscountPermissions } from '@/shared/access/discountPermissions'
import type { CreateStaffInput, StaffListItem } from '@/features/staff/types'

type StaffErrorCode = keyof typeof t.staff.errors

/** Resolve a machine code (from an RPC message or an Edge Function body) to Arabic copy. */
function messageForCode(code: string): string {
  const known = t.staff.errors as Record<string, string>
  return known[code] ?? t.staff.errors.generic
}

/** RPC errors surface the code inside the message; find the first known one. */
function rpcErrorMessage(message: string): string {
  const code = (Object.keys(t.staff.errors) as StaffErrorCode[]).find(
    (c) => c !== 'generic' && message.includes(c),
  )
  return code ? messageForCode(code) : t.staff.errors.generic
}

export async function listStaff(): Promise<StaffListItem[]> {
  const { data, error } = await supabase.rpc('list_staff')
  if (error) throw error
  const rows = (data as StaffListItem[]) ?? []
  return rows.map((row) => ({
    ...row,
    discount_permissions: row.discount_permissions
      ? parseDiscountPermissions(row.discount_permissions)
      : null,
  }))
}

export async function createStaffAccount(
  input: CreateStaffInput,
): Promise<void> {
  const { error } = await supabase.functions.invoke('staff-create', {
    body: {
      username: input.username,
      displayName: input.displayName,
      password: input.password,
      pin: input.pin || null,
      role: input.role,
      isActive: input.isActive,
      email: input.email || null,
    },
  })
  if (error) throw new Error(await edgeErrorMessage(error))
}

export async function changeStaffPassword(
  staffId: string,
  password: string,
): Promise<void> {
  const { error } = await supabase.functions.invoke('staff-reset-password', {
    body: { staffId, password },
  })
  if (error) throw new Error(await edgeErrorMessage(error))
}

export async function updateStaff(input: {
  staffId: string
  displayName: string
  branchId: string
  role: string
  discountPermissions?: import('@/shared/access/discountPermissions').DiscountPermissionConfig | null
}): Promise<void> {
  const { error } = await supabase.rpc('update_staff', {
    p_staff_id: input.staffId,
    p_display_name: input.displayName,
    p_branch_assignments: [{ branch_id: input.branchId, role: input.role }],
    p_discount_permissions: input.discountPermissions ?? null,
  })
  if (error) throw new Error(rpcErrorMessage(error.message))
}

export async function setStaffStatus(
  staffId: string,
  active: boolean,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_staff_status', {
    p_staff_id: staffId,
    p_active: active,
    p_reason: reason,
  })
  if (error) throw new Error(rpcErrorMessage(error.message))
}

export async function setStaffPin(staffId: string, pin: string): Promise<void> {
  const { error } = await supabase.rpc('set_staff_pin', {
    p_staff_id: staffId,
    p_pin: pin,
  })
  if (error) throw new Error(rpcErrorMessage(error.message))
}

export async function listBranches() {
  const { data, error } = await supabase
    .from('branches')
    .select('id, name, code')
    .eq('is_active', true)
    .order('name')

  if (error) throw error
  return data ?? []
}

/** Read a `{ code }` body from an Edge Function error response; fall back to generic. */
async function edgeErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: Response })?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { code?: string }
      if (body?.code) return messageForCode(body.code)
    } catch {
      // ignore parse failure; fall through to generic
    }
  }
  return t.staff.errors.generic
}
