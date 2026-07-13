import type { PostgrestError } from '@supabase/supabase-js'

export type AppErrorCode =
  'NETWORK' | 'AUTH' | 'PERMISSION' | 'VALIDATION' | 'BUSINESS_RULE' | 'UNKNOWN'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly userMessage: string
  readonly isRetryable: boolean

  constructor(options: {
    code: AppErrorCode
    userMessage: string
    isRetryable?: boolean
    cause?: unknown
  }) {
    super(options.userMessage)
    this.name = 'AppError'
    this.code = options.code
    this.userMessage = options.userMessage
    this.isRetryable = options.isRetryable ?? false
    if (options.cause) {
      this.cause = options.cause
    }
  }
}

export function mapSupabaseError(error: PostgrestError | Error): AppError {
  if (error instanceof AppError) {
    return error
  }

  const message = 'message' in error ? error.message : 'Unexpected error'

  if (message.toLowerCase().includes('jwt')) {
    return new AppError({
      code: 'AUTH',
      userMessage: 'Your session has expired. Please sign in again.',
      cause: error,
    })
  }

  return new AppError({
    code: 'UNKNOWN',
    userMessage: message,
    isRetryable: true,
    cause: error,
  })
}
