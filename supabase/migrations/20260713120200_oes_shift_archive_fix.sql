-- Fix get_shift_archive: orders use `reference`, not `order_number`

CREATE OR REPLACE FUNCTION public.get_shift_archive(p_shift_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_report jsonb;
  v_handovers jsonb;
  v_orders jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = p_shift_id AND restaurant_id = v_rest) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  v_report := public.get_shift_report(p_shift_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', h.id, 'reference', h.reference, 'kind', h.kind::text,
    'amount', h.amount, 'status', h.status::text,
    'created_at', h.created_at, 'received_at', h.received_at,
    'rejected_at', h.rejected_at, 'rejection_reason', h.rejection_reason,
    'cashier_name', cs.display_name, 'received_by_name', rs.display_name,
    'rejected_by_name', js.display_name, 'target_shift_id', h.target_shift_id,
    'transfer_id', h.transfer_id
  ) ORDER BY h.created_at), '[]'::jsonb)
  INTO v_handovers
  FROM public.shift_handovers h
  LEFT JOIN public.staff cs ON cs.id = h.created_by
  LEFT JOIN public.staff rs ON rs.id = h.received_by
  LEFT JOIN public.staff js ON js.id = h.rejected_by
  WHERE h.shift_id = p_shift_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'order_number', o.reference, 'order_type', o.order_type::text,
    'payment_status', o.payment_status::text, 'fulfillment_status', o.fulfillment_status::text,
    'total', o.total, 'created_at', o.created_at
  ) ORDER BY o.created_at), '[]'::jsonb)
  INTO v_orders
  FROM public.orders o
  WHERE o.shift_id = p_shift_id AND o.restaurant_id = v_rest;

  RETURN jsonb_build_object('report', v_report, 'handovers', v_handovers, 'orders', v_orders);
END;
$$;

NOTIFY pgrst, 'reload schema';
