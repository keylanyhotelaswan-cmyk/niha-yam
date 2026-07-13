import { corsHeaders } from '../_shared/cors.ts'
import { requireManager } from '../_shared/auth-guard.ts'
import { errorResponse, HttpError, jsonResponse } from '../_shared/http.ts'

/** Username → internal auth email (username-only UI; ADR-0018). Keep in sync with the client. */
const INTERNAL_EMAIL_DOMAIN = 'staff.niha.local'
const ROLES = ['owner', 'manager', 'cashier', 'waiter', 'kitchen']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const { actorUserId, service } = await requireManager(req)

    const body = await req.json().catch(() => null)
    if (!body) throw new HttpError(400, 'INVALID_BODY')

    const username = String(body.username ?? '')
      .trim()
      .toLowerCase()
    const displayName = String(body.displayName ?? '').trim()
    const password = String(body.password ?? '')
    const role = String(body.role ?? '')
    const isActive = body.isActive !== false
    const pin = body.pin ? String(body.pin) : null
    const email = body.email ? String(body.email).trim() : null

    if (!/^[a-z0-9._-]{3,32}$/.test(username))
      throw new HttpError(400, 'INVALID_USERNAME')
    if (displayName.length < 2) throw new HttpError(400, 'INVALID_NAME')
    if (password.length < 8) throw new HttpError(400, 'INVALID_PASSWORD')
    if (!ROLES.includes(role)) throw new HttpError(400, 'INVALID_ROLE')
    if (pin !== null && !/^[0-9]{4,6}$/.test(pin))
      throw new HttpError(400, 'INVALID_PIN')

    const internalEmail = `${username}@${INTERNAL_EMAIL_DOMAIN}`

    const { data: created, error: createErr } =
      await service.auth.admin.createUser({
        email: internalEmail,
        password,
        email_confirm: true,
        user_metadata: { username, display_name: displayName },
      })
    if (createErr || !created.user) {
      // Duplicate auth email means duplicate username.
      const msg = createErr?.message ?? ''
      if (/already been registered|already exists/i.test(msg)) {
        throw new HttpError(400, 'USERNAME_EXISTS')
      }
      throw new HttpError(400, 'AUTH_CREATE_FAILED')
    }

    const { data: staffId, error: provErr } = await service.rpc(
      'provision_staff',
      {
        p_actor_user_id: actorUserId,
        p_user_id: created.user.id,
        p_username: username,
        p_display_name: displayName,
        p_role: role,
        p_is_active: isActive,
        p_pin: pin,
        p_email: email,
      },
    )

    if (provErr) {
      // Roll back the orphaned auth user so create is all-or-nothing.
      await service.auth.admin.deleteUser(created.user.id)
      throw provErr
    }

    return jsonResponse({ staffId })
  } catch (err) {
    return errorResponse(err)
  }
})
