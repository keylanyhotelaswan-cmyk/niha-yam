-- Print Management capability: independent of manager role (staff flag).
-- Mirrors can_operational_purchase. Does not widen m4_require_manager.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS can_print_manage boolean;

COMMENT ON COLUMN public.staff.can_print_manage IS
  'NULL = role default (owner/manager true, others false). Explicit true/false overrides. Grants Print Center only.';

CREATE OR REPLACE FUNCTION public.print_staff_can_manage()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_staff_id uuid := public.auth_staff_id();
BEGIN
  IF v_staff_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT s.can_print_manage INTO v_flag
  FROM public.staff s
  WHERE s.id = v_staff_id;

  IF v_flag IS NOT NULL THEN
    RETURN v_flag;
  END IF;

  RETURN public.is_owner_or_manager();
END;
$$;

CREATE OR REPLACE FUNCTION public.print_require_manage()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL OR NOT public.print_staff_can_manage() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  RETURN v_rest;
END;
$$;

GRANT EXECUTE ON FUNCTION public.print_staff_can_manage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.print_require_manage() TO authenticated;

-- Rewire print RPCs: m4_require_manager / is_owner_or_manager → print_* helpers
DO $$
DECLARE
  r record;
  def text;
  names text[] := ARRAY[
    'get_printer_health',
    'list_print_bridges',
    'diagnose_print_system',
    'get_print_ops_settings',
    'set_testing_print_enabled',
    'm6_bootstrap_test_print_environment',
    'enqueue_test_print',
    'upsert_printer',
    'set_printer_active',
    'create_print_bridge_pair_code',
    'sync_print_station_bindings',
    'choose_cashier_windows_printer',
    'get_print_settings',
    'upsert_print_settings',
    'get_print_document_layout',
    'upsert_print_document_layout',
    'preview_print_document',
    'enqueue_layout_preview_print',
    'preview_print_template',
    'retry_print_job',
    'cancel_print_job',
    'print_job_again',
    'expire_stale_print_jobs',
    'm6_enqueue_shift_handover_print',
    'm6_build_handover_print_snapshot',
    'upsert_print_template',
    'list_print_templates'
  ];
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (names)
  LOOP
    def := pg_get_functiondef(r.oid);
    def := replace(def, 'public.m4_require_manager()', 'public.print_require_manage()');
    def := replace(def, 'NOT public.is_owner_or_manager()', 'NOT public.print_staff_can_manage()');
    def := replace(def, 'OR NOT public.is_owner_or_manager()', 'OR NOT public.print_staff_can_manage()');
    EXECUTE def;
  END LOOP;
END;
$$;

-- Profile: expose resolved + raw flag for admin nav
CREATE OR REPLACE FUNCTION public.get_my_staff_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff public.staff%ROWTYPE;
  v_branches jsonb;
BEGIN
  SELECT * INTO v_staff FROM public.staff WHERE user_id = auth.uid();
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'branch_id', sb.branch_id,
      'role', sb.role,
      'branch_name', b.name,
      'branch_code', b.code
    )
  ), '[]'::jsonb)
  INTO v_branches
  FROM public.staff_branches sb
  JOIN public.branches b ON b.id = sb.branch_id
  WHERE sb.staff_id = v_staff.id;

  RETURN jsonb_build_object(
    'id', v_staff.id,
    'user_id', v_staff.user_id,
    'restaurant_id', v_staff.restaurant_id,
    'username', v_staff.username,
    'display_name', v_staff.display_name,
    'is_active', v_staff.is_active,
    'branches', v_branches,
    'can_print_manage', public.print_staff_can_manage()
  );
END;
$$;

-- update_staff + list_staff
DROP FUNCTION IF EXISTS public.update_staff(uuid, text, jsonb, jsonb, boolean, boolean);

CREATE OR REPLACE FUNCTION public.update_staff(
  p_staff_id uuid,
  p_display_name text,
  p_branch_assignments jsonb,
  p_discount_permissions jsonb DEFAULT NULL,
  p_can_operational_purchase boolean DEFAULT NULL,
  p_set_operational_purchase boolean DEFAULT false,
  p_can_print_manage boolean DEFAULT NULL,
  p_set_print_manage boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_actor_id uuid;
  v_assignment jsonb;
  v_owner_count int;
  v_disc jsonb;
BEGIN
  v_actor_id := public.auth_staff_id();
  v_restaurant_id := public.auth_restaurant_id();

  IF v_actor_id IS NULL OR NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.id = p_staff_id AND s.restaurant_id = v_restaurant_id
  ) THEN
    RAISE EXCEPTION 'STAFF_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_branches sb
    WHERE sb.staff_id = p_staff_id AND sb.role = 'owner'
  ) THEN
    SELECT count(*)::int INTO v_owner_count
    FROM public.staff_branches sb
    JOIN public.staff s ON s.id = sb.staff_id
    WHERE s.restaurant_id = v_restaurant_id
      AND sb.role = 'owner'
      AND s.is_active = true;

    IF v_owner_count <= 1 AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_branch_assignments) elem
      WHERE (elem ->> 'role') = 'owner'
    ) THEN
      RAISE EXCEPTION 'LAST_OWNER_PROTECTED';
    END IF;
  END IF;

  IF p_discount_permissions IS NOT NULL THEN
    v_disc := public.m5_normalize_discount_permissions(p_discount_permissions);
  END IF;

  UPDATE public.staff
  SET
    display_name = trim(p_display_name),
    discount_permissions = CASE
      WHEN p_discount_permissions IS NOT NULL THEN v_disc
      ELSE discount_permissions
    END,
    can_operational_purchase = CASE
      WHEN p_set_operational_purchase THEN p_can_operational_purchase
      ELSE can_operational_purchase
    END,
    can_print_manage = CASE
      WHEN p_set_print_manage THEN p_can_print_manage
      ELSE can_print_manage
    END,
    updated_at = now()
  WHERE id = p_staff_id;

  DELETE FROM public.staff_branches WHERE staff_id = p_staff_id;

  FOR v_assignment IN SELECT value FROM jsonb_array_elements(p_branch_assignments)
  LOOP
    INSERT INTO public.staff_branches (staff_id, branch_id, role)
    VALUES (
      p_staff_id,
      (v_assignment ->> 'branch_id')::uuid,
      (v_assignment ->> 'role')::public.staff_role
    );
  END LOOP;

  PERFORM public.log_audit_event(
    v_restaurant_id,
    'staff.updated',
    NULL,
    v_actor_id,
    'staff',
    p_staff_id,
    NULL,
    jsonb_build_object(
      'display_name', trim(p_display_name),
      'discount_permissions', v_disc,
      'can_operational_purchase', CASE
        WHEN p_set_operational_purchase THEN to_jsonb(p_can_operational_purchase)
        ELSE NULL
      END,
      'can_print_manage', CASE
        WHEN p_set_print_manage THEN to_jsonb(p_can_print_manage)
        ELSE NULL
      END
    )
  );
END;
$$;

DROP FUNCTION IF EXISTS public.list_staff();

CREATE OR REPLACE FUNCTION public.list_staff()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  username text,
  display_name text,
  is_active boolean,
  branches jsonb,
  created_at timestamptz,
  discount_permissions jsonb,
  can_operational_purchase boolean,
  can_print_manage boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_owner_or_manager() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.user_id,
    s.username,
    s.display_name,
    s.is_active,
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'branch_id', sb.branch_id,
            'role', sb.role,
            'branch_name', b.name
          )
        )
        FROM public.staff_branches sb
        JOIN public.branches b ON b.id = sb.branch_id
        WHERE sb.staff_id = s.id
      ),
      '[]'::jsonb
    ),
    s.created_at,
    s.discount_permissions,
    s.can_operational_purchase,
    s.can_print_manage
  FROM public.staff s
  WHERE s.restaurant_id = public.auth_restaurant_id()
  ORDER BY s.display_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_staff(uuid, text, jsonb, jsonb, boolean, boolean, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_staff_profile() TO authenticated;
