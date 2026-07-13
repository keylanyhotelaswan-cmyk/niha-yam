import { corsHeaders } from './cors.ts'

/** Error carrying an HTTP status + a stable machine code (mapped to Arabic on the client). */
export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Maps thrown errors (incl. Postgres RPC errors) to a stable { code } payload. */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return jsonResponse({ code: err.code }, err.status)
  }
  // Postgres RAISE EXCEPTION 'X' surfaces as message containing the code.
  const message =
    typeof err === 'object' && err && 'message' in err
      ? String((err as { message: unknown }).message)
      : 'UNKNOWN'
  const known = [
    'PERMISSION_DENIED',
    'STAFF_NOT_FOUND',
    'BRANCH_NOT_FOUND',
    'USERNAME_EXISTS',
    'INVALID_USERNAME',
    'INVALID_PIN',
    'PIN_INVALID',
    'SESSION_MINT_FAILED',
  ]
  const code = known.find((k) => message.includes(k)) ?? 'UNKNOWN'
  const status = code === 'PERMISSION_DENIED' ? 403 : 400
  return jsonResponse({ code }, code === 'UNKNOWN' ? 500 : status)
}
