-- OC v1.1: archive receive count/variance fields only (print identity patched separately)

CREATE OR REPLACE FUNCTION public.list_shifts_archive(p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rest uuid := public.m4_require_manager();
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.opened_at DESC)
    FROM (
      SELECT s.id, s.reference, s.status, s.opened_at, s.closed_at, s.actual_cash_count,
        opener.display_name AS opened_by_name, closer.display_name AS closed_by_name,
        (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', h.id,
            'reference', h.reference,
            'kind', h.kind::text,
            'amount', h.amount,
            'status', h.status::text,
            'created_at', h.created_at,
            'received_at', h.received_at,
            'rejected_at', h.rejected_at,
            'rejection_reason', h.rejection_reason,
            'cashier_name', cs.display_name,
            'received_by_name', rs.display_name,
            'target_shift_id', h.target_shift_id,
            'target_shift_reference', ts.reference,
            'source_variance', round(coalesce((
              SELECT sum(vm.amount) FROM public.treasury_movements vm
              WHERE vm.shift_id = h.shift_id AND vm.source = 'variance'
                AND coalesce(vm.source_ref_type, '') <> 'shift_handover'
            ), 0)::numeric, 2),
            'receiver_opening_float', round(coalesce((
              SELECT sum(om.amount) FROM public.treasury_movements om
              WHERE om.shift_id = h.target_shift_id AND om.source = 'opening_float'
            ), 0)::numeric, 2),
            'receiver_starting_trust', round((
              coalesce(h.received_actual_cash, h.amount) + coalesce((
                SELECT sum(om.amount) FROM public.treasury_movements om
                WHERE om.shift_id = h.target_shift_id AND om.source = 'opening_float'
              ), 0)
            )::numeric, 2),
            'received_actual_cash', h.received_actual_cash,
            'receive_variance', h.receive_variance
          ) ORDER BY h.created_at), '[]'::jsonb)
          FROM public.shift_handovers h
          LEFT JOIN public.staff cs ON cs.id = h.created_by
          LEFT JOIN public.staff rs ON rs.id = h.received_by
          LEFT JOIN public.shifts ts ON ts.id = h.target_shift_id
          WHERE h.shift_id = s.id
        ) AS handovers
      FROM public.shifts s
      LEFT JOIN public.staff opener ON opener.id = s.opened_by
      LEFT JOIN public.staff closer ON closer.id = s.closed_by
      WHERE s.restaurant_id = v_rest
      ORDER BY s.opened_at DESC
      LIMIT LEAST(coalesce(p_limit, 50), 200)
    ) x
  ), '[]'::jsonb);
END;
$$;
