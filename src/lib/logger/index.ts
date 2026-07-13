type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogPayload = {
  message: string
  feature?: string
  action?: string
  correlationId?: string
  meta?: Record<string, unknown>
}

function write(level: LogLevel, payload: LogPayload) {
  if (import.meta.env.DEV || level === 'warn' || level === 'error') {
    console[level](`[${level}]`, payload)
  }
}

export const logger = {
  debug: (payload: LogPayload) => write('debug', payload),
  info: (payload: LogPayload) => write('info', payload),
  warn: (payload: LogPayload) => write('warn', payload),
  error: (payload: LogPayload) => write('error', payload),
}
