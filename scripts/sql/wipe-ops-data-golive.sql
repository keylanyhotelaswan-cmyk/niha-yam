-- One-shot operational wipe for go-live: clear transactional data only.
-- Keeps: restaurants, branches, staff, menu, treasury account definitions,
--         payment methods, printers/bridges, layouts, inventory masters/recipes.
-- Reports are derived from movements/orders — clearing sources clears reports.

DO $$
DECLARE
  r uuid := 'a0000000-0000-4000-8000-000000000001';
BEGIN
  -- Feedback + handovers (FK → shifts)
  BEGIN
    DELETE FROM public.ops_feedback_comments
    WHERE feedback_id IN (SELECT id FROM public.ops_feedback WHERE restaurant_id = r);
    DELETE FROM public.ops_feedback WHERE restaurant_id = r;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM public.shift_handovers WHERE restaurant_id = r;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Detach / delete dependents of print_jobs before delete
  BEGIN
    UPDATE public.ops_messages
    SET print_job_id = NULL
    WHERE restaurant_id = r;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
  BEGIN
    DELETE FROM public.ops_messages WHERE restaurant_id = r;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    DELETE FROM public.print_attempts
    WHERE print_job_id IN (SELECT id FROM public.print_jobs WHERE restaurant_id = r);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    UPDATE public.print_jobs
    SET reprint_of_job_id = NULL
    WHERE restaurant_id = r;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  BEGIN
    DELETE FROM public.kitchen_ticket_lines
    WHERE ticket_id IN (SELECT id FROM public.kitchen_tickets WHERE restaurant_id = r);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
  BEGIN
    DELETE FROM public.kitchen_tickets WHERE restaurant_id = r;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
  BEGIN
    DELETE FROM public.print_jobs WHERE restaurant_id = r;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Orders + children
  DELETE FROM public.order_item_modifiers
  WHERE order_item_id IN (
    SELECT oi.id FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.restaurant_id = r
  );
  DELETE FROM public.order_items
  WHERE order_id IN (SELECT id FROM public.orders WHERE restaurant_id = r);

  BEGIN
    DELETE FROM public.order_events
    WHERE order_id IN (SELECT id FROM public.orders WHERE restaurant_id = r);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
  BEGIN
    DELETE FROM public.order_amendments
    WHERE order_id IN (SELECT id FROM public.orders WHERE restaurant_id = r);
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  DELETE FROM public.order_payments
  WHERE order_id IN (SELECT id FROM public.orders WHERE restaurant_id = r);
  DELETE FROM public.orders WHERE restaurant_id = r;

  -- Treasury ledger (break self-FK first)
  BEGIN
    UPDATE public.treasury_movements
    SET reverses_movement_id = NULL
    WHERE restaurant_id = r;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  DELETE FROM public.treasury_movements WHERE restaurant_id = r;
  DELETE FROM public.treasury_transfers WHERE restaurant_id = r;
  BEGIN
    DELETE FROM public.treasury_adjustments WHERE restaurant_id = r;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
  DELETE FROM public.expenses WHERE restaurant_id = r;
  DELETE FROM public.shifts WHERE restaurant_id = r;

  DELETE FROM public.financial_ref_counters WHERE restaurant_id = r;

  -- Customers created during test ops
  BEGIN
    DELETE FROM public.customer_phones WHERE restaurant_id = r;
    DELETE FROM public.customer_addresses WHERE restaurant_id = r;
    DELETE FROM public.customers WHERE restaurant_id = r;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Inventory movements only (keep locations/ingredients/recipes)
  BEGIN
    UPDATE public.stock_movements
    SET reverses_movement_id = NULL
    WHERE restaurant_id = r;
    DELETE FROM public.stock_movements WHERE restaurant_id = r;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END $$;
