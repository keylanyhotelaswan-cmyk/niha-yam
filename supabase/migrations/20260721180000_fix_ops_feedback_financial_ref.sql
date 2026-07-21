-- Fix ops_feedback (NT-*) financial refs: next_financial_ref / exists used to fall
-- through to treasury_transfers for unknown types, so NT collisions were not detected
-- after financial_ref_counters resets (e.g. M4 cleanup).

CREATE OR REPLACE FUNCTION public.financial_ref_table_max(
  p_restaurant_id uuid,
  p_ref_type text,
  p_prefix text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max bigint := 0;
  v_part bigint;
BEGIN
  IF p_ref_type = 'order' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.orders
    WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'payment' THEN
    SELECT coalesce(max(substring(op.reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.order_payments op
    JOIN public.orders o ON o.id = op.order_id
    WHERE o.restaurant_id = p_restaurant_id AND op.reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'kitchen_ticket' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.kitchen_tickets
    WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'print_job' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.print_jobs
    WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'handover' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.shift_handovers
    WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'purchase' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.purchases
    WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'ops_feedback' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.ops_feedback
    WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'shift' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.shifts
    WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type = 'expense' THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.expenses
    WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type IN ('deposit', 'withdrawal') THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.treasury_adjustments
    WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  ELSIF p_ref_type IN ('cash_drop', 'transfer', 'variance') THEN
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_part
    FROM public.treasury_transfers
    WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
    v_max := coalesce(v_part, 0);
  ELSE
    SELECT coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) INTO v_max
    FROM public.treasury_transfers
    WHERE restaurant_id = p_restaurant_id AND reference LIKE p_prefix || '-%';
  END IF;
  RETURN coalesce(v_max, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_ref_exists(
  p_restaurant_id uuid,
  p_ref_type text,
  p_reference text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift uuid;
BEGIN
  IF p_ref_type = 'order' THEN
    IF p_reference ~ '^[0-9]+$' THEN
      SELECT s.id INTO v_shift
      FROM public.shifts s
      WHERE s.restaurant_id = p_restaurant_id AND s.status = 'open'
      ORDER BY s.opened_at DESC LIMIT 1;
      IF v_shift IS NOT NULL THEN
        RETURN EXISTS (
          SELECT 1 FROM public.orders
          WHERE restaurant_id = p_restaurant_id
            AND shift_id = v_shift
            AND reference = p_reference
        );
      END IF;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.orders
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'payment' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.order_payments op
      JOIN public.orders o ON o.id = op.order_id
      WHERE o.restaurant_id = p_restaurant_id AND op.reference = p_reference
    );
  ELSIF p_ref_type = 'kitchen_ticket' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.kitchen_tickets
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'print_job' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.print_jobs
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'handover' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.shift_handovers
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'purchase' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.purchases
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'ops_feedback' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.ops_feedback
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'shift' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.shifts
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type = 'expense' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.expenses
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type IN ('deposit', 'withdrawal') THEN
    RETURN EXISTS (
      SELECT 1 FROM public.treasury_adjustments
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSIF p_ref_type IN ('cash_drop', 'transfer', 'variance') THEN
    RETURN EXISTS (
      SELECT 1 FROM public.treasury_transfers
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  ELSE
    RETURN EXISTS (
      SELECT 1 FROM public.treasury_transfers
      WHERE restaurant_id = p_restaurant_id AND reference = p_reference
    );
  END IF;
END;
$$;