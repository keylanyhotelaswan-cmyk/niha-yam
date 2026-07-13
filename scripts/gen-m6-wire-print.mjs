import { readFileSync, writeFileSync } from 'node:fs'

function load(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
}

function extractFn(sql, name) {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(')
  if (start < 0) throw new Error('missing ' + name)
  const marker = 'END; ' + '$$' + ';'
  const end = sql.indexOf(marker, start)
  if (end < 0) throw new Error('no end for ' + name)
  return sql.slice(start, end + marker.length)
}

const DQ = '$$' // dollar-quote body delimiter (avoid PowerShell / template issues)

const src = load('supabase/migrations/20260709120200_m5_close_out_part3_orders.sql')

let unpaid = extractFn(src, 'create_unpaid_order')
const unpaidNeedle =
  "  IF p_delivery_driver_id IS NOT NULL THEN\n" +
  "    PERFORM public.assign_delivery_driver(v_order_id, p_delivery_driver_id, 'تعيين عند الإنشاء');\n" +
  '  END IF;\n' +
  '\n' +
  '  RETURN jsonb_build_object(\n' +
  "    'order_id', v_order_id,\n" +
  "    'reference', v_ord_ref,\n" +
  "    'money', public.m5c_order_money_snapshot(v_order_id)\n" +
  '  );\n' +
  'END; ' +
  DQ +
  ';'
const unpaidRepl =
  "  IF p_delivery_driver_id IS NOT NULL THEN\n" +
  "    PERFORM public.assign_delivery_driver(v_order_id, p_delivery_driver_id, 'تعيين عند الإنشاء');\n" +
  '  END IF;\n' +
  '\n' +
  '  -- M6: kitchen@create only (no receipt for unpaid)\n' +
  '  PERFORM public.m6_enqueue_order_prints_on_create(v_order_id, false);\n' +
  '\n' +
  '  RETURN jsonb_build_object(\n' +
  "    'order_id', v_order_id,\n" +
  "    'reference', v_ord_ref,\n" +
  "    'money', public.m5c_order_money_snapshot(v_order_id)\n" +
  '  );\n' +
  'END; ' +
  DQ +
  ';'
if (!unpaid.includes(unpaidNeedle)) throw new Error('unpaid needle miss')
unpaid = unpaid.split(unpaidNeedle).join(unpaidRepl)

let fin = extractFn(src, 'finalize_sale')
const finNeedle =
  "  v_pj_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');\n" +
  '  INSERT INTO public.print_jobs (restaurant_id, order_id, reference, kind, status, payload)\n' +
  "  VALUES (v_rest, v_order_id, v_pj_ref, 'receipt', 'pending',\n" +
  "    jsonb_build_object('order_reference', v_ord_ref, 'total', v_total))\n" +
  '  RETURNING id INTO v_pj_id;\n' +
  '\n' +
  "  PERFORM public.record_order_event(v_order_id, 'print.enqueued', 'print_job', v_pj_id,\n" +
  "    jsonb_build_object('kind', 'receipt', 'reference', v_pj_ref));\n" +
  '\n' +
  '  IF v_has_kitchen THEN\n' +
  "    v_pj_ref := public.next_financial_ref(v_rest, 'print_job', 'PJ');\n" +
  '    INSERT INTO public.print_jobs (restaurant_id, order_id, reference, kind, status, payload)\n' +
  "    VALUES (v_rest, v_order_id, v_pj_ref, 'kitchen', 'pending',\n" +
  "      jsonb_build_object('order_reference', v_ord_ref, 'kitchen_ticket', v_kt_ref));\n" +
  "    PERFORM public.record_order_event(v_order_id, 'print.enqueued', 'print_job', NULL,\n" +
  "      jsonb_build_object('kind', 'kitchen', 'reference', v_pj_ref));\n" +
  '  END IF;\n'
const finRepl =
  '  -- M6: kitchen@create + receipt@Pay Now\n' +
  '  PERFORM public.m6_enqueue_order_prints_on_create(v_order_id, true);\n'
if (!fin.includes(finNeedle)) throw new Error('finalize needle miss')
fin = fin.split(finNeedle).join(finRepl)

const collectSrc = load(
  'supabase/migrations/20260709100400_m5c_partial_collect.sql',
)
let col = extractFn(collectSrc, 'record_collection')
const colNeedle =
  '  PERFORM public.m5b_recalc_order_payment_status(p_order_id);\n' +
  "  RETURN jsonb_build_object('payment_ids', to_jsonb(v_ids));\n" +
  'END; ' +
  DQ +
  ';'
const colRepl =
  '  PERFORM public.m5b_recalc_order_payment_status(p_order_id);\n' +
  '\n' +
  '  -- M6: receipt on each real collection\n' +
  '  PERFORM public.m6_enqueue_receipt_on_collection(p_order_id);\n' +
  '\n' +
  "  RETURN jsonb_build_object('payment_ids', to_jsonb(v_ids));\n" +
  'END; ' +
  DQ +
  ';'
if (!col.includes(colNeedle)) throw new Error('collect needle miss')
col = col.split(colNeedle).join(colRepl)

const delSrc = load('supabase/migrations/20260708200100_m5b_rpcs_part1.sql')
let del = extractFn(delSrc, 'create_delivery_order')
const delNeedle =
  "  PERFORM public.record_order_event(v_order_id, 'order.created', 'order', v_order_id,\n" +
  "    jsonb_build_object('reference', v_ord_ref, 'total', v_total, 'order_type', 'delivery'));\n" +
  '\n' +
  "  RETURN jsonb_build_object('order_id', v_order_id, 'reference', v_ord_ref, 'total', v_total);\n" +
  'END; ' +
  DQ +
  ';'
const delRepl =
  "  PERFORM public.record_order_event(v_order_id, 'order.created', 'order', v_order_id,\n" +
  "    jsonb_build_object('reference', v_ord_ref, 'total', v_total, 'order_type', 'delivery'));\n" +
  '\n' +
  '  -- M6: kitchen@create only\n' +
  '  PERFORM public.m6_enqueue_order_prints_on_create(v_order_id, false);\n' +
  '\n' +
  "  RETURN jsonb_build_object('order_id', v_order_id, 'reference', v_ord_ref, 'total', v_total);\n" +
  'END; ' +
  DQ +
  ';'
if (!del.includes(delNeedle)) throw new Error('delivery needle miss')
del = del.split(delNeedle).join(delRepl)

const out = [
  '-- M6C: Wire sale/create/collection RPCs to document-type print enqueue',
  '',
  unpaid,
  '',
  fin,
  '',
  col,
  '',
  del,
  '',
  "NOTIFY pgrst, 'reload schema';",
  '',
].join('\n')

const outPath = 'supabase/migrations/20260711020100_m6c_wire_order_print_rpcs.sql'
writeFileSync(outPath, out)

const ends = [...out.matchAll(/END; \$+/g)].map((m) => m[0])
console.log('ok', {
  unpaid: unpaid.includes('m6_enqueue_order_prints_on_create'),
  fin:
    fin.includes('m6_enqueue_order_prints_on_create') &&
    !fin.includes('INSERT INTO public.print_jobs'),
  col: col.includes('m6_enqueue_receipt_on_collection'),
  del: del.includes('m6_enqueue_order_prints_on_create'),
  ends,
  bytes: out.length,
})
if (ends.some((e) => e !== 'END; $$')) {
  throw new Error('dollar-quote corruption: ' + JSON.stringify(ends))
}
