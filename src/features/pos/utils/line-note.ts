/** Free-sauce + labeled custom-note helpers for POS line notes (kitchen-visible). */

import type { PosCategory, PosMenuItem } from '@/features/pos/types'

/** Kitchen-facing labels (Arabic). */
export const SAUCE_LABEL = 'صوص'
export const NOTE_LABEL = 'ملاحظة'

export function isFreeSauceCategoryName(name: string): boolean {
  const n = name.trim()
  return n.includes('مجانية') || n === 'صوصات مجانية'
}

export function isFreeSauceMenuItem(
  item: PosMenuItem,
  categories: PosCategory[] | undefined,
): boolean {
  if (!categories?.length) return false
  const cat =
    categories.find((c) => c.id === item.category_id) ??
    categories.find((c) => c.items.some((i) => i.id === item.id))
  return cat ? isFreeSauceCategoryName(cat.name) : false
}

export function freeSauceMenuItems(
  categories: PosCategory[] | undefined,
): PosMenuItem[] {
  if (!categories?.length) return []
  const seen = new Set<string>()
  const out: PosMenuItem[] = []
  for (const cat of categories) {
    if (!isFreeSauceCategoryName(cat.name)) continue
    for (const item of cat.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      out.push(item)
    }
  }
  return out
}

export function noteParts(note: string | null | undefined): string[] {
  if (!note?.trim()) return []
  return note
    .split(/[،,]/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export function joinNoteParts(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join('، ')
}

function barePart(part: string): string {
  return part.replace(/^\+\s*/, '').trim()
}

function uniquePreserve(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const key = item.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function stripLeadingLabel(text: string, label: string): string {
  const re = new RegExp(`^${label}\\s*[:：]\\s*`, 'u')
  return text.replace(re, '').trim()
}

/** Collapse spaces / mixed commas into clean Arabic-joined parts. */
export function normalizeCustomNote(text: string | null | undefined): string {
  if (!text?.trim()) return ''
  const cleaned = stripLeadingLabel(
    text
      .replace(/\s+/g, ' ')
      .replace(/[;؛|/·•]+/g, '،')
      .trim(),
    NOTE_LABEL,
  )
  return joinNoteParts(noteParts(cleaned))
}

function sectionChunks(note: string): string[] {
  return note
    .split(/\s*[·|—–]\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Parse kitchen note into sauces + free text.
 * Supports labeled form: `صوص: ثوم، باربكيو · ملاحظة: حار`
 * and legacy unlabeled comma lists.
 */
export function splitLineNote(
  note: string | null | undefined,
  sauceNames: string[] = [],
): { sauces: string[]; custom: string } {
  if (!note?.trim()) return { sauces: [], custom: '' }

  const names = uniquePreserve(sauceNames)
  const chunks = sectionChunks(note.trim())
  const sauces: string[] = []
  const custom: string[] = []
  let sawLabel = false

  for (const chunk of chunks) {
    const sauceMatch = chunk.match(/^صوص\s*[:：]\s*(.+)$/u)
    const noteMatch = chunk.match(/^ملاحظة\s*[:：]\s*(.+)$/u)
    if (sauceMatch) {
      sawLabel = true
      for (const p of noteParts(sauceMatch[1])) {
        const bare = barePart(p)
        if (!sauces.includes(bare)) sauces.push(bare)
      }
      continue
    }
    if (noteMatch) {
      sawLabel = true
      custom.push(...noteParts(noteMatch[1]))
      continue
    }
  }

  if (sawLabel) {
    return {
      sauces: uniquePreserve(sauces),
      custom: joinNoteParts(custom),
    }
  }

  // Legacy unlabeled: classify by known sauce names.
  for (const part of noteParts(note)) {
    const bare = barePart(part)
    const matched = names.find((n) => n === part || n === bare)
    if (matched) {
      if (!sauces.includes(matched)) sauces.push(matched)
    } else {
      custom.push(part)
    }
  }
  return { sauces, custom: joinNoteParts(custom) }
}

/**
 * If the cashier typed a free-sauce name into the custom field,
 * promote it to sauces and keep the rest as free text.
 */
export function extractSaucesFromText(
  text: string | null | undefined,
  sauceNames: string[],
): { sauces: string[]; custom: string } {
  return splitLineNote(normalizeCustomNote(text), sauceNames)
}

/** Build kitchen text: `صوص: …` and/or `ملاحظة: …`. */
export function mergeLineNote(sauces: string[], custom: string): string {
  const sauceList = uniquePreserve(sauces).map(barePart)
  const sauceSet = new Set(sauceList)
  const customParts = noteParts(normalizeCustomNote(custom)).filter((p) => {
    const bare = barePart(p)
    return !sauceSet.has(p) && !sauceSet.has(bare)
  })
  const sections: string[] = []
  if (sauceList.length > 0) {
    sections.push(`${SAUCE_LABEL}: ${joinNoteParts(sauceList)}`)
  }
  if (customParts.length > 0) {
    sections.push(`${NOTE_LABEL}: ${joinNoteParts(customParts)}`)
  }
  return sections.join(' · ')
}

/** Replace only the free-text portion; keep existing sauces; promote typed sauces. */
export function setCustomInNote(
  note: string | null | undefined,
  custom: string,
  sauceNames: string[],
): string {
  const current = splitLineNote(note, sauceNames)
  const fromText = extractSaucesFromText(custom, sauceNames)
  return mergeLineNote(
    [...current.sauces, ...fromText.sauces],
    fromText.custom,
  )
}

export function noteHasSauce(
  note: string | null | undefined,
  sauceName: string,
  sauceNames: string[] = [],
): boolean {
  const target = sauceName.trim()
  if (!target) return false
  const names = uniquePreserve([...sauceNames, target])
  return splitLineNote(note, names).sauces.some(
    (s) => s === target || barePart(s) === target,
  )
}

/** Display lines for UI / kitchen (one section per line when labeled). */
export function noteDisplayLines(
  note: string | null | undefined,
): string[] {
  if (!note?.trim()) return []
  const text = note.trim()
  if (
    /^صوص\s*[:：]/u.test(text) ||
    /^ملاحظة\s*[:：]/u.test(text) ||
    /\s[·|—–]\s/.test(text)
  ) {
    return sectionChunks(text)
  }
  return [text]
}

export function toggleSauceInNote(
  note: string | null | undefined,
  sauceName: string,
  sauceNames: string[] = [],
): string {
  const target = sauceName.trim()
  if (!target) return note?.trim() ?? ''
  const names = uniquePreserve([...sauceNames, target])
  const { sauces, custom } = splitLineNote(note, names)
  const next = [...sauces]
  const idx = next.findIndex((s) => s === target || barePart(s) === target)
  if (idx >= 0) next.splice(idx, 1)
  else next.push(target)
  return mergeLineNote(next, custom)
}
