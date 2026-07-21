-- Serialize shift-scoped order references under concurrent finalize_sale /
-- create_unpaid_order. max(orders.reference)+1 alone can race if callers do
-- not hold the shift row lock through INSERT; allocate via an atomic counter
-- on shifts (row UPDATE + optional advisory lock).

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS order_ref_seq bigint NOT NULL DEFAULT 0;

UPDATE public.shifts s
SET order_ref_seq = greatest(s.order_ref_seq, coalesce(m.mx, 0))
FROM (
  SELECT
    o.shift_id,
    max(
      CASE
        WHEN o.reference ~ '^[0-9]+$' THEN o.reference::bigint
        ELSE 0
      END
    ) AS mx
  FROM public.orders o
  WHERE o.shift_id IS NOT NULL
  GROUP BY o.shift_id
) m
WHERE s.id = m.shift_id;

CREATE OR REPLACE FUNCTION public.next_shift_order_ref(
  p_restaurant_id uuid,
  p_shift_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next bigint;
BEGIN
  -- Transaction-scoped advisory lock keyed by restaurant+shift (belt).
  PERFORM pg_advisory_xact_lock(
    87201402,
    hashtext(p_restaurant_id::text || chr(1) || p_shift_id::text)
  );

  -- Row UPDATE locks the shift until end of transaction (suspenders).
  -- Raise the floor to max(existing numeric refs) then increment once.
  UPDATE public.shifts AS s
  SET order_ref_seq = greatest(
      s.order_ref_seq,
      coalesce(
        (
          SELECT max(
            CASE
              WHEN o.reference ~ '^[0-9]+$' THEN o.reference::bigint
              ELSE 0
            END
          )
          FROM public.orders o
          WHERE o.restaurant_id = p_restaurant_id
            AND o.shift_id = p_shift_id
        ),
        0
      )
    ) + 1
  WHERE s.id = p_shift_id
    AND s.restaurant_id = p_restaurant_id
  RETURNING s.order_ref_seq INTO v_next;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATE';
  END IF;

  RETURN v_next::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_shift_order_ref(uuid, uuid) TO authenticated;