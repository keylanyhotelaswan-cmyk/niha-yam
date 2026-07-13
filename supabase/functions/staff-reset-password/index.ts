import { corsHeaders } from '../_shared/cors.ts'
import { requireManager } from '../_shared/auth-guard.ts'
import { errorResponse, HttpError, jsonResponse } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const { actorUserId, service } = await requireManager(req)

    const body = await req.json().catch(() => null)
    if (!body) throw new HttpError(400, 'INVALID_BODY')

    const staffId = String(body.staffId ?? '')
    const password = String(body.password ?? '')
    if (!staffId) throw new HttpError(400, 'INVALID_BODY')
    if (password.length < 8) throw new HttpError(400, 'INVALID_PASSWORD')

    // Target + actor must share the same restaurant (single-restaurant, defense-in-depth).
    const { data: target, error: tErr } = await service
      .from('staff')
      .select('user_id, restaurant_id')
      .eq('id', staffId)
      .maybeSingle()
    if (tErr) throw tErr
    if (!target) throw new HttpError(404, 'STAFF_NOT_FOUND')

    const { data: actor, error: aErr } = await service
      .from('staff')
      .select('restaurant_id')
      .eq('user_id', actorUserId)
      .maybeSingle()
    if (aErr) throw aErr
    if (!actor || actor.restaurant_id !== target.restaurant_id) {
      throw new HttpError(403, 'PERMISSION_DENIED')
    }

    const { error: updErr } = await service.auth.admin.updateUserById(
      target.user_id,
      {
        password,
      },
    )
    if (updErr) throw new HttpError(400, 'AUTH_UPDATE_FAILED')

    const { error: auditErr } = await service.rpc('record_password_change', {
      p_actor_user_id: actorUserId,
      p_staff_id: staffId,
    })
    if (auditErr) throw auditErr

    return jsonResponse({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
})
