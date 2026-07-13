import {
  enqueueShiftHandoverPrint,
  fetchHandoverPrintSnapshot,
} from '@/features/print/api/print.api'
import { formatDateTime, formatMoney } from '@/features/treasury/utils/format'
import { t } from '@/shared/i18n'

export type HandoverReceiptKind = 'handover' | 'receive'

export type HandoverReceiptData = {
  kind: HandoverReceiptKind
  reference: string
  shiftReference: string
  cashierName: string
  amount: number
  destination: 'to_main' | 'to_next_shift' | string
  at: string
  receivedByName?: string | null
}

type PaymentMethodSnap = {
  code?: string
  name?: string
  amount?: number
  counts_toward_handover?: boolean
}

type HandoverSnapshot = {
  title_ar?: string
  handover_reference?: string
  shift_reference?: string
  cashier_name?: string
  received_by_name?: string
  destination_label_ar?: string
  trust_amount?: number
  total_collected?: number
  variance?: number
  printed_at?: string
  payment_methods?: PaymentMethodSnap[]
  trust_note_ar?: string
  phase?: string
}

function destinationLabel(dest: string): string {
  if (dest === 'to_main') return t.treasury.shift.destinationToMain
  if (dest === 'to_next_shift') return t.treasury.shift.destinationToNext
  return dest
}

/**
 * Primary: NIHA Print Bridge (`shift_handover` job).
 * Fallback: browser print (rich snapshot when available).
 */
export async function printShiftHandoverReceipt(
  handoverId: string,
  phase: HandoverReceiptKind,
  fallback?: HandoverReceiptData,
): Promise<'bridge' | 'browser'> {
  try {
    await enqueueShiftHandoverPrint(handoverId, phase)
    return 'bridge'
  } catch {
    let snap: HandoverSnapshot | null = null
    try {
      snap = (await fetchHandoverPrintSnapshot(
        handoverId,
        phase,
      )) as HandoverSnapshot
    } catch {
      snap = null
    }
    if (snap) printHandoverReceiptFromSnapshot(snap)
    else if (fallback) printHandoverReceipt(fallback)
    return 'browser'
  }
}

export function printHandoverReceiptFromSnapshot(snap: HandoverSnapshot): void {
  const title = snap.title_ar ?? t.treasury.handover.receiptHandoverTitle
  const rows: Array<[string, string]> = [
    [t.treasury.handover.receiptRef, snap.handover_reference ?? '—'],
    [t.treasury.handover.receiptShift, snap.shift_reference ?? '—'],
    [t.treasury.handover.receiptCashier, snap.cashier_name || '—'],
    [
      t.treasury.handover.receiptDestination,
      snap.destination_label_ar ?? '—',
    ],
    [
      t.treasury.common.date,
      formatDateTime(snap.printed_at ?? new Date().toISOString()),
    ],
  ]

  const methods = snap.payment_methods ?? []
  const methodRows = methods.map((m) => {
    const label = m.counts_toward_handover
      ? (m.name ?? m.code ?? '—')
      : `${m.name ?? m.code ?? '—'} (${t.treasury.handover.receiptReviewOnly})`
    return [label, formatMoney(Number(m.amount ?? 0))] as [string, string]
  })

  if (snap.received_by_name) {
    rows.push([t.treasury.handover.receivedBy, snap.received_by_name])
  }

  const footRows: Array<[string, string]> = [
    [
      t.treasury.handover.receiptTotalCollected,
      formatMoney(Number(snap.total_collected ?? 0)),
    ],
    [
      t.treasury.handover.receiptTrustCash,
      formatMoney(Number(snap.trust_amount ?? 0)),
    ],
  ]
  if (Math.abs(Number(snap.variance ?? 0)) > 0.001) {
    footRows.push([
      t.treasury.handover.receiptVariance,
      formatMoney(Number(snap.variance)),
    ])
  }

  openPrintWindow(title, rows, methodRows, footRows, snap.trust_note_ar)
}

/**
 * Minimal browser print slip — Bridge unavailable / no snapshot.
 */
export function printHandoverReceipt(data: HandoverReceiptData): void {
  const title =
    data.kind === 'receive'
      ? t.treasury.handover.receiptReceiveTitle
      : t.treasury.handover.receiptHandoverTitle
  const rows: Array<[string, string]> = [
    [t.treasury.handover.receiptRef, data.reference],
    [t.treasury.handover.receiptShift, data.shiftReference],
    [t.treasury.handover.receiptCashier, data.cashierName || '—'],
    [t.treasury.common.amount, formatMoney(data.amount)],
    [t.treasury.handover.receiptDestination, destinationLabel(data.destination)],
    [t.treasury.common.date, formatDateTime(data.at)],
  ]
  if (data.kind === 'receive' && data.receivedByName) {
    rows.push([t.treasury.handover.receivedBy, data.receivedByName])
  }
  openPrintWindow(title, rows, [], [], t.treasury.handover.receiptFooter)
}

function openPrintWindow(
  title: string,
  metaRows: Array<[string, string]>,
  methodRows: Array<[string, string]>,
  footRows: Array<[string, string]>,
  note?: string | null,
): void {
  const rowHtml = (pairs: Array<[string, string]>) =>
    pairs
      .map(
        ([label, value]) =>
          `<tr><td style="padding:6px 0;color:#64748b;font-size:12px">${label}</td>` +
          `<td style="padding:6px 0;text-align:left;font-weight:600;font-size:13px" dir="ltr">${value}</td></tr>`,
      )
      .join('')

  const methodsBlock =
    methodRows.length > 0
      ? `<h2 style="font-size:13px;margin:14px 0 6px;text-align:center">تفصيل التحصيل</h2>` +
        `<div class="box"><table>${rowHtml(methodRows)}</table></div>`
      : ''

  const footBlock =
    footRows.length > 0
      ? `<div class="box" style="margin-top:10px"><table>${rowHtml(footRows)}</table></div>`
      : ''

  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<title>${title}</title>
<style>
  body{font-family:Tahoma,'Segoe UI',sans-serif;margin:16px;color:#0f172a}
  h1{font-size:16px;margin:0 0 12px;text-align:center}
  .box{border:1px solid #cbd5e1;border-radius:8px;padding:12px 14px}
  table{width:100%;border-collapse:collapse}
  .foot{margin-top:14px;font-size:11px;color:#64748b;text-align:center}
  @media print{body{margin:0}}
</style></head><body>
  <h1>${title}</h1>
  <div class="box"><table>${rowHtml(metaRows)}</table></div>
  ${methodsBlock}
  ${footBlock}
  <p class="foot">${note ?? t.treasury.handover.receiptFooter}</p>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close()},400)}</script>
</body></html>`

  const w = window.open('', '_blank', 'noopener,noreferrer,width=420,height=640')
  if (!w) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}
