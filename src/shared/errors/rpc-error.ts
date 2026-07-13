/** Map Postgres RPC exception codes to Arabic; append raw message in DEV. */
export function mapRpcError(
  message: string,
  catalog: Record<string, string>,
  generic: string,
): string {
  const code = Object.keys(catalog).find(
    (c) => c !== 'generic' && message.includes(c),
  )
  const mapped = code ? catalog[code]! : generic
  if (import.meta.env.DEV) return `${mapped} [DEV: ${message}]`
  return mapped
}
