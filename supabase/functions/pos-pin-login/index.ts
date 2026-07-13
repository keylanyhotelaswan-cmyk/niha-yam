import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { corsHeaders } from '../_shared/cors.ts'
import { errorResponse, HttpError, jsonResponse } from '../_shared/http.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => null)
    if (!body) throw new HttpError(400, 'INVALID_BODY')

    const pin = String(body.pin ?? '')
    if (!/^[0-9]{4,6}$/.test(pin)) throw new HttpError(400, 'INVALID_PIN')

    const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: userId, error: pinErr } = await service.rpc(
      'resolve_staff_user_by_pin',
      { p_pin: pin },
    )
    if (pinErr) throw pinErr
    if (!userId) throw new HttpError(401, 'PIN_INVALID')

    const { data: userData, error: userErr } =
      await service.auth.admin.getUserById(userId)
    const email = userData.user?.email
    if (userErr || !email) throw new HttpError(401, 'PIN_INVALID')

    const { data: linkData, error: linkErr } =
      await service.auth.admin.generateLink({
        type: 'magiclink',
        email,
      })
    const hashedToken = linkData?.properties?.hashed_token
    if (linkErr || !hashedToken) throw new HttpError(500, 'SESSION_MINT_FAILED')

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    })
    const { data: sessionData, error: otpErr } = await anon.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'email',
    })
    if (otpErr || !sessionData.session) {
      throw new HttpError(500, 'SESSION_MINT_FAILED')
    }

    return jsonResponse({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
    })
  } catch (err) {
    return errorResponse(err)
  }
})
