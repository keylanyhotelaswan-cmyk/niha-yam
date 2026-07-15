import type { ReactNode } from 'react'
import type {
  DocumentLayout,
  FieldStyle,
  SectionAlign,
  SectionStyle,
} from '@/features/print/layout/sections'
import {
  fieldStyle,
  mergeLayout,
  type PrintDocumentType,
} from '@/features/print/layout/sections'
import { fieldLabelOnly, fieldPrintText } from '@/features/print/layout/field-text'
import { noteDisplayLines } from '@/features/pos/utils/line-note'
import { cn } from '@/shared/utils/cn'

type Props = {
  documentType: PrintDocumentType
  layout: DocumentLayout
  snapshot: Record<string, unknown>
  className?: string
}

function alignClass(a: SectionAlign): string {
  if (a === 'center') return 'text-center'
  if (a === 'left') return 'text-left'
  return 'text-right'
}

function Line({
  style,
  children,
  className,
}: {
  style: FieldStyle | SectionStyle
  children: ReactNode
  className?: string
}) {
  const spaceBefore =
    'space_before' in style ? (style.space_before as number) : 0
  const spaceAfter = 'space_after' in style ? (style.space_after as number) : 0
  return (
    <div
      className={cn(alignClass(style.align), style.bold && 'font-bold', className)}
      style={{
        fontSize: `${style.font_pt}px`,
        marginTop: spaceBefore * 2,
        marginBottom: spaceAfter * 2,
        lineHeight: 1.35,
      }}
    >
      {children}
    </div>
  )
}

function str(snap: Record<string, unknown>, key: string): string | null {
  const v = snap[key]
  if (v == null) return null
  const s = String(v).trim()
  return s ? s : null
}

function money(n: unknown, cur: string): string {
  const num = typeof n === 'number' ? n : Number(n)
  const text = Number.isFinite(num) ? num.toFixed(2) : String(n ?? '')
  return cur ? `${text} ${cur}` : text
}

function Rule({ solid, dashed }: { solid?: boolean; dashed?: boolean }) {
  return (
    <div
      className={cn(
        'my-2 border-t',
        solid ? 'border-neutral-900' : 'border-neutral-500',
        dashed && 'border-dashed',
      )}
    />
  )
}

function SectionBox({
  section,
  children,
}: {
  section: SectionStyle
  children: ReactNode
}) {
  const padTop = Math.max(0, section.space_before) * 6
  const padBottom = Math.max(0, section.space_after) * 6
  return (
    <div
      style={{
        paddingTop: padTop,
        paddingBottom: padBottom,
      }}
    >
      {children}
    </div>
  )
}

function FieldLine({
  section,
  fieldId,
  text,
  rawValue,
}: {
  section: SectionStyle
  fieldId: string
  /** Pre-composed text (legacy). Prefer rawValue. */
  text?: string | null | undefined
  rawValue?: string | null | undefined
}) {
  const f = fieldStyle(section, fieldId)
  if (!f) return null
  const line =
    rawValue !== undefined ? fieldPrintText(f, rawValue) : text
  if (!line) return null
  return <Line style={f}>{line}</Line>
}

function LabeledMoney({
  field,
  amount,
  cur,
}: {
  field: FieldStyle
  amount: unknown
  cur: string
}) {
  const label = fieldLabelOnly(field)
  const value = money(amount, cur)
  const line = label ? ( /[:：#]$/.test(label) ? `${label}${value}` : `${label}: ${value}`) : value
  return <Line style={field}>{line}</Line>
}

export function ThermalReceiptPreview({
  documentType,
  layout: rawLayout,
  snapshot,
  className,
}: Props) {
  const layout =
    rawLayout?.version === 2 &&
    Array.isArray(rawLayout.section_order) &&
    rawLayout.section_order.length > 0
      ? rawLayout
      : mergeLayout(documentType, rawLayout)
  const isKitchen = documentType === 'kitchen'
  const widthMm = layout.paper_width_mm
  const cur = str(snapshot, 'currency_label') ?? ''

  function sec(id: string): SectionStyle | null {
    const s = layout.sections[id]
    if (!s || !s.visible) return null
    return s
  }

  function renderSection(id: string) {
    const s = sec(id)
    if (!s) return null

    switch (id) {
      case 'restaurant_name':
        return (
          <SectionBox section={s}>
            <FieldLine
              section={s}
              fieldId="name"
              text={str(snapshot, 'restaurant_name')}
            />
          </SectionBox>
        )
      case 'slogan':
        return (
          <SectionBox section={s}>
            <FieldLine section={s} fieldId="text" text={str(snapshot, 'slogan')} />
          </SectionBox>
        )
      case 'ticket_header': {
        const titleField = fieldStyle(s, 'title')
        const title = fieldLabelOnly(titleField)
        return (
          <SectionBox section={s}>
            {title && titleField ? <Line style={titleField}>{title}</Line> : null}
          </SectionBox>
        )
      }
      case 'branch_info':
        return (
          <SectionBox section={s}>
            <FieldLine
              section={s}
              fieldId="address"
              text={str(snapshot, 'restaurant_address')}
            />
            <FieldLine
              section={s}
              fieldId="phone"
              text={str(snapshot, 'restaurant_phone')}
            />
          </SectionBox>
        )
      case 'invoice_meta':
      case 'order_meta': {
        return (
          <SectionBox section={s}>
            {isKitchen ? (
              <FieldLine
                section={s}
                fieldId="order_reference"
                rawValue={str(snapshot, 'order_reference')}
              />
            ) : (
              <>
                <FieldLine
                  section={s}
                  fieldId="invoice_number"
                  rawValue={str(snapshot, 'order_reference')}
                />
                <FieldLine
                  section={s}
                  fieldId="order_reference"
                  rawValue={str(snapshot, 'order_reference')}
                />
              </>
            )}
            {isKitchen ? (
              <FieldLine
                section={s}
                fieldId="kitchen_ticket"
                rawValue={str(snapshot, 'kitchen_ticket')}
              />
            ) : null}
            <FieldLine
              section={s}
              fieldId="order_type"
              rawValue={str(snapshot, 'order_type_ar')}
            />
            <FieldLine
              section={s}
              fieldId="created_by_name"
              rawValue={
                str(snapshot, 'created_by_name') ?? str(snapshot, 'cashier')
              }
            />
            {!isKitchen ? (
              <>
                <FieldLine
                  section={s}
                  fieldId="last_edited_by_name"
                  rawValue={str(snapshot, 'last_edited_by_name')}
                />
                <FieldLine
                  section={s}
                  fieldId="collected_by_name"
                  rawValue={str(snapshot, 'collected_by_name')}
                />
              </>
            ) : null}
            <FieldLine
              section={s}
              fieldId="created_at"
              rawValue={str(snapshot, 'created_at')}
            />
            {!isKitchen ? (
              <>
                <FieldLine
                  section={s}
                  fieldId="last_edited_at"
                  rawValue={str(snapshot, 'last_edited_at')}
                />
                <FieldLine
                  section={s}
                  fieldId="collected_at"
                  rawValue={str(snapshot, 'collected_at')}
                />
              </>
            ) : null}
            <FieldLine
              section={s}
              fieldId="printed_at"
              rawValue={
                str(snapshot, 'printed_at') ?? str(snapshot, 'datetime')
              }
            />
          </SectionBox>
        )
      }
      case 'customer':
      case 'customer_or_table':
        return (
          <SectionBox section={s}>
            <FieldLine
              section={s}
              fieldId="table_ref"
              rawValue={str(snapshot, 'table_ref')}
            />
            <FieldLine
              section={s}
              fieldId="customer_name"
              rawValue={str(snapshot, 'customer_name')}
            />
            <FieldLine
              section={s}
              fieldId="customer_phone"
              rawValue={str(snapshot, 'customer_phone')}
            />
            <FieldLine
              section={s}
              fieldId="delivery_zone"
              rawValue={str(snapshot, 'delivery_zone')}
            />
            <FieldLine
              section={s}
              fieldId="delivery_address"
              rawValue={str(snapshot, 'delivery_address')}
            />
            {!isKitchen ? (
              <FieldLine
                section={s}
                fieldId="delivery_notes"
                rawValue={str(snapshot, 'delivery_notes')}
              />
            ) : null}
            <FieldLine
              section={s}
              fieldId="driver_name"
              rawValue={str(snapshot, 'driver_name')}
            />
          </SectionBox>
        )
      case 'ops':
        return (
          <SectionBox section={s}>
            <FieldLine
              section={s}
              fieldId="shift_reference"
              rawValue={str(snapshot, 'shift_reference')}
            />
            <FieldLine
              section={s}
              fieldId="branch_name"
              rawValue={
                str(snapshot, 'branch_name') ?? str(snapshot, 'restaurant_name')
              }
            />
            <FieldLine
              section={s}
              fieldId="device_name"
              rawValue={str(snapshot, 'device_name')}
            />
          </SectionBox>
        )
      case 'lines': {
        const lines = Array.isArray(snapshot.lines) ? snapshot.lines : []
        const itemF = fieldStyle(s, 'item_line')
        const priceF = fieldStyle(s, 'price')
        const modF = fieldStyle(s, 'modifiers')
        const noteF = fieldStyle(s, 'note')
        if (!itemF && !priceF) return null
        return (
          <SectionBox section={s}>
            {lines.map((raw, i) => {
              const line = raw as Record<string, unknown>
              const name = String(line.name ?? '')
              const qty = String(line.quantity ?? 1)
              const label = `${qty}x ${name}`
              return (
                <div key={i} className="mb-1">
                  {isKitchen ? (
                    itemF ? (
                      <div
                        className={cn(alignClass(itemF.align), itemF.bold && 'font-bold')}
                        style={{ fontSize: itemF.font_pt }}
                      >
                        {label}
                      </div>
                    ) : null
                  ) : (
                    <div
                      className={cn(
                        'flex gap-2',
                        (itemF ?? priceF)?.align === 'center' &&
                          'justify-center',
                        (itemF ?? priceF)?.align === 'left' && 'justify-start',
                        (itemF ?? priceF)?.align === 'right' &&
                          'justify-between',
                      )}
                    >
                      {itemF ? (
                        <span
                          className={cn(
                            'min-w-0',
                            (itemF.align === 'right' || !priceF) && 'flex-1',
                            itemF.bold && 'font-bold',
                            alignClass(itemF.align),
                          )}
                          style={{ fontSize: itemF.font_pt }}
                        >
                          {label}
                        </span>
                      ) : (
                        <span />
                      )}
                      {priceF ? (
                        <span
                          className={cn(
                            'shrink-0',
                            priceF.bold && 'font-bold',
                            alignClass(priceF.align),
                          )}
                          style={{ fontSize: priceF.font_pt }}
                        >
                          {money(line.line_total, cur)}
                        </span>
                      ) : null}
                    </div>
                  )}
                  {modF && Array.isArray(line.modifiers)
                    ? line.modifiers.map((m, mi) => {
                        const modName =
                          typeof m === 'string'
                            ? m
                            : String((m as { name?: string }).name ?? '')
                        if (!modName) return null
                        const delta =
                          typeof m === 'object' &&
                          m &&
                          'price_delta' in m &&
                          Number((m as { price_delta?: number }).price_delta) !== 0
                            ? ` (${money((m as { price_delta: number }).price_delta, cur)})`
                            : ''
                        return (
                          <div
                            key={mi}
                            className={cn(alignClass(modF.align), 'opacity-80')}
                            style={{ fontSize: modF.font_pt }}
                          >
                            + {modName}{delta}
                          </div>
                        )
                      })
                    : null}
                  {noteF && line.note ? (
                    noteDisplayLines(String(line.note)).map((row) => (
                      <div
                        key={row}
                        className={alignClass(noteF.align)}
                        style={{ fontSize: noteF.font_pt }}
                      >
                        {row}
                      </div>
                    ))
                  ) : null}
                </div>
              )
            })}
          </SectionBox>
        )
      }
      case 'order_note':
        return (
          <SectionBox section={s}>
            <FieldLine
              section={s}
              fieldId="note"
              rawValue={str(snapshot, 'order_note')}
            />
          </SectionBox>
        )
      case 'totals': {
        const totalF = fieldStyle(s, 'total')
        const subF = fieldStyle(s, 'subtotal')
        const discF = fieldStyle(s, 'discount')
        const taxF = fieldStyle(s, 'tax')
        const disc =
          typeof snapshot.discount_amount === 'number'
            ? snapshot.discount_amount
            : Number(snapshot.discount_amount ?? 0)
        const discType = str(snapshot, 'discount_type')
        const discValue = Number(snapshot.discount_value ?? 0)
        const tax =
          typeof snapshot.tax_amount === 'number'
            ? snapshot.tax_amount
            : Number(snapshot.tax_amount ?? 0)
        const discLabel =
          str(snapshot, 'discount_label_ar') ||
          (discType === 'percent' && discValue > 0
            ? `خصم ${discValue}%`
            : discType === 'amount' && discValue > 0
              ? `خصم ${money(discValue, cur)}`
              : null)
        return (
          <SectionBox section={s}>
            <div className="border-2 border-neutral-900 px-2 py-3">
              {disc > 0 && subF ? (
                <LabeledMoney field={subF} amount={snapshot.subtotal} cur={cur} />
              ) : null}
              {disc > 0 && discF ? (
                <>
                  {discLabel ? (
                    <div
                      className={cn(alignClass(discF.align), discF.bold && 'font-bold')}
                      style={{ fontSize: discF.font_pt }}
                    >
                      {discLabel}
                    </div>
                  ) : (
                    <LabeledMoney field={discF} amount={disc} cur={cur} />
                  )}
                  {discType === 'percent' && disc > 0 ? (
                    <div
                      className={cn(alignClass(discF.align))}
                      style={{ fontSize: Math.max(10, discF.font_pt - 2) }}
                    >
                      قيمة الخصم: {money(disc, cur)}
                    </div>
                  ) : null}
                </>
              ) : null}
              {tax > 0 && taxF ? (
                <LabeledMoney field={taxF} amount={tax} cur={cur} />
              ) : null}
              {totalF ? (
                <>
                  {fieldLabelOnly(totalF) ? (
                    <div
                      className={cn(alignClass(totalF.align), 'font-bold')}
                      style={{ fontSize: Math.max(12, totalF.font_pt - 4) }}
                    >
                      {fieldLabelOnly(totalF)}
                    </div>
                  ) : null}
                  <div
                    className={cn(alignClass(totalF.align), totalF.bold && 'font-bold')}
                    style={{ fontSize: totalF.font_pt }}
                  >
                    {money(snapshot.total, cur)}
                  </div>
                </>
              ) : null}
            </div>
          </SectionBox>
        )
      }
      case 'payment': {
        const linesF = fieldStyle(s, 'payment_lines')
        const methodF = fieldStyle(s, 'method')
        const statusF = fieldStyle(s, 'status')
        const changeF = fieldStyle(s, 'change')
        const payments = Array.isArray(snapshot.payments) ? snapshot.payments : []
        const method = str(snapshot, 'payment_method')
        const status = str(snapshot, 'payment_status_ar')
        const change =
          typeof snapshot.change_total === 'number'
            ? snapshot.change_total
            : Number(snapshot.change_total ?? 0)
        const methodLine = methodF ? fieldPrintText(methodF, method) : null
        const statusLine = statusF ? fieldPrintText(statusF, status) : null
        const header = fieldLabelOnly(linesF)
        return (
          <SectionBox section={s}>
            {linesF && payments.length > 0 ? (
              <div className="mb-2 space-y-1">
                {header ? (
                  <div
                    className={cn(alignClass(linesF.align), linesF.bold && 'font-bold')}
                    style={{ fontSize: linesF.font_pt }}
                  >
                    {header}
                  </div>
                ) : null}
                {payments.map((raw, i) => {
                  const p = raw as { method?: string; amount?: number; net_amount?: number }
                  const name = String(p.method ?? '').trim()
                  if (!name) return null
                  const amt = p.net_amount ?? p.amount
                  return (
                    <div
                      key={i}
                      className="flex justify-between gap-2"
                      style={{ fontSize: linesF.font_pt }}
                    >
                      <span>{name}</span>
                      <span>{money(amt, cur)}</span>
                    </div>
                  )
                })}
              </div>
            ) : null}
            {(methodLine || statusLine) && (
              <div className="border-2 border-neutral-900 px-2 py-2">
                <div className="flex justify-between gap-2">
                  {methodLine && methodF ? (
                    <span
                      className={cn(methodF.bold && 'font-bold')}
                      style={{ fontSize: methodF.font_pt }}
                    >
                      {methodLine}
                    </span>
                  ) : (
                    <span />
                  )}
                  {statusLine && statusF ? (
                    <span
                      className={cn(statusF.bold && 'font-bold')}
                      style={{ fontSize: statusF.font_pt }}
                    >
                      {statusLine}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
            {change > 0 && changeF ? (
              <LabeledMoney field={changeF} amount={change} cur={cur} />
            ) : null}
          </SectionBox>
        )
      }
      case 'qr': {
        const codeF = fieldStyle(s, 'code')
        if (!codeF || !snapshot.show_qr) return null
        return (
          <SectionBox section={s}>
            <Line style={codeF}>
              <span className="inline-block border border-dashed border-neutral-500 px-6 py-6 text-xs">
                QR
              </span>
            </Line>
          </SectionBox>
        )
      }
      case 'thank_you':
        return (
          <SectionBox section={s}>
            <FieldLine
              section={s}
              fieldId="message"
              text={str(snapshot, 'thank_you')}
            />
          </SectionBox>
        )
      default:
        return null
    }
  }

  const order = layout.section_order
  const afterMeta = new Set([
    'customer',
    'customer_or_table',
    'lines',
    'order_note',
    'totals',
    'payment',
    'qr',
    'thank_you',
  ])

  return (
    <div
      dir="rtl"
      className={cn(
        'mx-auto rounded-sm border border-neutral-300 bg-[#f7f4ef] text-neutral-900 shadow-inner',
        className,
      )}
      style={{
        width: widthMm === 58 ? 220 : 300,
        padding: '14px 12px 20px',
        fontFamily: '"Segoe UI", Tahoma, sans-serif',
      }}
    >
      {order.map((id, idx) => {
        const node = renderSection(id)
        if (!node) return null
        const prev = order[idx - 1]
        const showSolidBefore =
          prev &&
          (id === 'invoice_meta' ||
            id === 'order_meta' ||
            (afterMeta.has(id) &&
              (prev === 'invoice_meta' ||
                prev === 'order_meta' ||
                prev === 'customer' ||
                prev === 'customer_or_table' ||
                prev === 'branch_info' ||
                prev === 'slogan' ||
                prev === 'ticket_header' ||
                prev === 'restaurant_name')))
        const showDashBefore = id === 'lines' || id === 'totals' || id === 'order_note'
        return (
          <div key={id}>
            {showSolidBefore ? <Rule solid /> : null}
            {showDashBefore ? <Rule dashed /> : null}
            {node}
          </div>
        )
      })}
    </div>
  )
}
