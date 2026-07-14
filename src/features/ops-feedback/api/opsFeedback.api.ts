import { supabase } from '@/lib/supabase/client'
import { fetchStaffProfile } from '@/shared/session/session.api'

export type OpsFeedbackKind = 'problem' | 'suggestion' | 'inquiry' | 'note'
export type OpsFeedbackPriority = 'normal' | 'important' | 'urgent'
export type OpsFeedbackStatus = 'new' | 'in_review' | 'resolved' | 'closed'
export type OpsFeedbackContext =
  | 'order'
  | 'print_job'
  | 'handover'
  | 'treasury'
  | 'shift'
  | 'none'

export type OpsFeedbackRow = {
  id: string
  reference: string
  title: string
  body: string
  kind: OpsFeedbackKind
  priority: OpsFeedbackPriority
  status: OpsFeedbackStatus
  created_at: string
  created_by: string
  created_by_name: string | null
  shift_id: string | null
  shift_reference: string | null
  device_label: string | null
  app_version: string | null
  bridge_version: string | null
  context_type: OpsFeedbackContext | null
  context_id: string | null
  image_path: string | null
  resolution_note: string | null
  resolved_in_version: string | null
  resolved_at: string | null
  resolved_by_name: string | null
}

export type OpsFeedbackComment = {
  id: string
  body: string
  created_at: string
  created_by_name: string | null
}

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (
    supabase.rpc as (
      name: string,
      args?: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  )(fn, args)

function wrap(error: { message: string }): Error {
  return new Error(error.message)
}

export async function submitOpsFeedback(input: {
  title: string
  body: string
  kind: OpsFeedbackKind
  priority: OpsFeedbackPriority
  imagePath?: string | null
  contextType?: OpsFeedbackContext | null
  contextId?: string | null
  deviceLabel?: string | null
  appVersion?: string | null
  bridgeVersion?: string | null
}): Promise<{ id: string; reference: string }> {
  const { data, error } = await rpc('submit_ops_feedback', {
    p_title: input.title,
    p_body: input.body,
    p_kind: input.kind,
    p_priority: input.priority,
    p_image_path: input.imagePath ?? null,
    p_context_type: input.contextType ?? null,
    p_context_id: input.contextId ?? null,
    p_device_label: input.deviceLabel ?? null,
    p_app_version: input.appVersion ?? null,
    p_bridge_version: input.bridgeVersion ?? null,
  })
  if (error) throw wrap(error)
  return data as { id: string; reference: string }
}

export async function listOpsFeedbackAdmin(filters?: {
  status?: OpsFeedbackStatus | null
  search?: string
  limit?: number
  offset?: number
}): Promise<OpsFeedbackRow[]> {
  const { data, error } = await rpc('list_ops_feedback_admin', {
    p_status: filters?.status ?? null,
    p_search: filters?.search ?? null,
    p_limit: filters?.limit ?? 50,
    p_offset: filters?.offset ?? 0,
  })
  if (error) throw wrap(error)
  return (data as OpsFeedbackRow[]) ?? []
}

export async function updateOpsFeedbackStatus(input: {
  id: string
  status: OpsFeedbackStatus
  resolutionNote?: string | null
  resolvedInVersion?: string | null
}): Promise<void> {
  const { error } = await rpc('update_ops_feedback_status', {
    p_id: input.id,
    p_status: input.status,
    p_resolution_note: input.resolutionNote ?? null,
    p_resolved_in_version: input.resolvedInVersion ?? null,
  })
  if (error) throw wrap(error)
}

export async function addOpsFeedbackComment(
  feedbackId: string,
  body: string,
): Promise<string> {
  const { data, error } = await rpc('add_ops_feedback_comment', {
    p_feedback_id: feedbackId,
    p_body: body,
  })
  if (error) throw wrap(error)
  return data as string
}

export async function listOpsFeedbackComments(
  feedbackId: string,
): Promise<OpsFeedbackComment[]> {
  const { data, error } = await rpc('list_ops_feedback_comments', {
    p_feedback_id: feedbackId,
  })
  if (error) throw wrap(error)
  return (data as OpsFeedbackComment[]) ?? []
}

export async function uploadOpsFeedbackImage(file: File): Promise<string> {
  const profile = await fetchStaffProfile()
  if (!profile?.restaurant_id) {
    throw new Error('PERMISSION_DENIED')
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext)
    ? ext
    : 'jpg'
  const path = `${profile.restaurant_id}/${crypto.randomUUID()}.${safeExt}`
  const { error } = await supabase.storage.from('ops-feedback').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  })
  if (error) throw new Error(error.message)
  return path
}

export async function getOpsFeedbackImageUrl(
  path: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('ops-feedback')
    .createSignedUrl(path, 3600)
  if (error) return null
  return data.signedUrl
}
