/**
 * Testing helpers: ensure operating liquidity when reserved allocations
 * exceed Main cash (reported reserved is capped at main → operating stays 0
 * until enough release_to_operating rows bring the uncapped sum below main).
 */
export async function ensureOperatingFunds(rpc, record, {
  treasuryId,
  minOperating = 500,
  label = 'operating',
} = {}) {
  const maxRounds = 40
  for (let i = 0; i < maxRounds; i++) {
    const snap = (await rpc('liq_get_snapshot')).data
    const op = Number(snap?.operating_balance ?? 0)
    const main = Number(snap?.main_balance ?? 0)
    const reserved = Number(snap?.reserved_balance ?? 0)
    if (op >= minOperating) {
      if (i === 0) record(`${label} operating ok`, true, `op=${op}`)
      else record(`${label} operating ok`, true, `op=${op} rounds=${i}`)
      return snap
    }
    if (main < minOperating) {
      const deposit = Math.ceil(minOperating - main + 100)
      const adj = await rpc('create_adjustment', {
        p_treasury_id: treasuryId,
        p_kind: 'deposit',
        p_amount: deposit,
        p_reason: `${label} operating deposit`,
      })
      if (adj.error) {
        record(`${label} deposit`, false, adj.error.message)
        return snap
      }
      continue
    }
    // When capped (reserved ≈ main, op ≈ 0), release the full reported reserved
    // each round until uncapped allocations fall below main.
    const releaseAmt = Math.round(Math.min(reserved, Math.max(minOperating - op, reserved)) * 100) / 100
    if (releaseAmt < 0.01) {
      record(`${label} release`, false, `stuck op=${op} main=${main} res=${reserved}`)
      return snap
    }
    const rel = await rpc('liq_release_reserved', {
      p_amount: releaseAmt,
      p_reason: `${label} reserved to operating round ${i + 1}`,
    })
    if (rel.error) {
      record(`${label} release`, false, rel.error.message)
      return snap
    }
  }
  const finalSnap = (await rpc('liq_get_snapshot')).data
  record(
    `${label} operating ok`,
    Number(finalSnap?.operating_balance ?? 0) >= minOperating,
    `op=${finalSnap?.operating_balance} after ${maxRounds} rounds`,
  )
  return finalSnap
}

/** Release reserved until reported reserved is at least `headroom` below main. */
export async function uncapReservedHeadroom(rpc, record, { headroom = 100, label = 'uncap' } = {}) {
  const maxRounds = 40
  for (let i = 0; i < maxRounds; i++) {
    const snap = (await rpc('liq_get_snapshot')).data
    const main = Number(snap?.main_balance ?? 0)
    const reserved = Number(snap?.reserved_balance ?? 0)
    const op = main - reserved
    if (op >= headroom || reserved < 0.01) {
      record(label, true, `op=${op} res=${reserved} rounds=${i}`)
      return snap
    }
    const targetRes = Math.max(0, main - headroom)
    const toRelease = Math.round(Math.max(0.01, Math.min(reserved, reserved - targetRes + 0.01)) * 100) / 100
    const rel = await rpc('liq_release_reserved', {
      p_amount: Math.min(toRelease, reserved),
      p_reason: `${label} round ${i + 1}`,
    })
    if (rel.error) {
      record(label, false, rel.error.message)
      return snap
    }
  }
  const finalSnap = (await rpc('liq_get_snapshot')).data
  record(label, Number(finalSnap?.main_balance ?? 0) - Number(finalSnap?.reserved_balance ?? 0) >= headroom,
    `op=${Number(finalSnap?.main_balance) - Number(finalSnap?.reserved_balance)}`)
  return finalSnap
}