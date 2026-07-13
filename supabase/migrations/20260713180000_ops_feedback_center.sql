-- Operational Polish v1.2 — Operations Feedback Center
-- Cashier shift notes for live ops (not a new money capability).

CREATE TABLE IF NOT EXISTS public.ops_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  reference text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('problem', 'suggestion', 'inquiry', 'note')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'important', 'urgent')),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_review', 'resolved', 'closed')),
  created_by uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  branch_id uuid,
  device_label text,
  app_version text,
  bridge_version text,
  context_type text
    CHECK (context_type IS NULL OR context_type IN (
      'order', 'print_job', 'handover', 'treasury', 'shift', 'none'
    )),
  context_id uuid,
  image_path text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  resolution_note text,
  resolved_in_version text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_ops_feedback_rest_created
  ON public.ops_feedback (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_feedback_status
  ON public.ops_feedback (restaurant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ops_feedback_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL REFERENCES public.ops_feedback(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ops_feedback_comments_fb
  ON public.ops_feedback_comments (feedback_id, created_at);

ALTER TABLE public.ops_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_feedback_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY ops_feedback_select ON public.ops_feedback
  FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY ops_feedback_insert ON public.ops_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.auth_restaurant_id()
    AND created_by = public.auth_staff_id()
  );

CREATE POLICY ops_feedback_update ON public.ops_feedback
  FOR UPDATE TO authenticated
  USING (
    restaurant_id = public.auth_restaurant_id()
    AND public.is_owner_or_manager()
  );

CREATE POLICY ops_feedback_comments_select ON public.ops_feedback_comments
  FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY ops_feedback_comments_insert ON public.ops_feedback_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id = public.auth_restaurant_id()
    AND public.is_owner_or_manager()
  );

-- Storage bucket for optional photos (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ops-feedback',
  'ops-feedback',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY ops_feedback_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ops-feedback');

CREATE POLICY ops_feedback_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ops-feedback');

-- Submit (cashier)
CREATE OR REPLACE FUNCTION public.submit_ops_feedback(
  p_title text,
  p_body text,
  p_kind text,
  p_priority text DEFAULT 'normal',
  p_image_path text DEFAULT NULL,
  p_context_type text DEFAULT NULL,
  p_context_id uuid DEFAULT NULL,
  p_device_label text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_bridge_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_actor uuid := public.auth_staff_id();
  v_shift uuid;
  v_branch uuid;
  v_ref text;
  v_id uuid;
  v_ctx text := nullif(trim(coalesce(p_context_type, '')), '');
BEGIN
  IF v_rest IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF length(trim(coalesce(p_title, ''))) < 2 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF length(trim(coalesce(p_body, ''))) < 2 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_kind NOT IN ('problem', 'suggestion', 'inquiry', 'note') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF p_priority NOT IN ('normal', 'important', 'urgent') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF v_ctx IS NOT NULL AND v_ctx NOT IN ('order', 'print_job', 'handover', 'treasury', 'shift', 'none') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT id INTO v_shift FROM public.shifts
  WHERE restaurant_id = v_rest AND status = 'open' LIMIT 1;

  SELECT sb.branch_id INTO v_branch
  FROM public.staff_branches sb
  WHERE sb.staff_id = v_actor
  LIMIT 1;

  v_ref := public.next_financial_ref(v_rest, 'ops_feedback', 'NT');

  INSERT INTO public.ops_feedback (
    restaurant_id, reference, title, body, kind, priority, status,
    created_by, shift_id, branch_id, device_label, app_version, bridge_version,
    context_type, context_id, image_path
  ) VALUES (
    v_rest, v_ref, trim(p_title), trim(p_body), p_kind, p_priority, 'new',
    v_actor, v_shift, v_branch,
    nullif(trim(coalesce(p_device_label, '')), ''),
    nullif(trim(coalesce(p_app_version, '')), ''),
    nullif(trim(coalesce(p_bridge_version, '')), ''),
    coalesce(v_ctx, 'none'),
    p_context_id,
    nullif(trim(coalesce(p_image_path, '')), '')
  )
  RETURNING id INTO v_id;

  PERFORM public.log_audit_event(
    v_rest, 'ops_feedback.created', NULL, v_actor, 'ops_feedback', v_id, NULL,
    jsonb_build_object('reference', v_ref, 'kind', p_kind, 'priority', p_priority)
  );

  RETURN jsonb_build_object('id', v_id, 'reference', v_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_ops_feedback_admin(
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
  v_search text := nullif(trim(coalesce(p_search, '')), '');
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(row ORDER BY created_at DESC)
    FROM (
      SELECT jsonb_build_object(
        'id', f.id,
        'reference', f.reference,
        'title', f.title,
        'body', f.body,
        'kind', f.kind,
        'priority', f.priority,
        'status', f.status,
        'created_at', f.created_at,
        'created_by', f.created_by,
        'created_by_name', s.display_name,
        'shift_id', f.shift_id,
        'shift_reference', sh.reference,
        'device_label', f.device_label,
        'app_version', f.app_version,
        'bridge_version', f.bridge_version,
        'context_type', f.context_type,
        'context_id', f.context_id,
        'image_path', f.image_path,
        'resolution_note', f.resolution_note,
        'resolved_in_version', f.resolved_in_version,
        'resolved_at', f.resolved_at,
        'resolved_by_name', rs.display_name
      ) AS row, f.created_at
      FROM public.ops_feedback f
      LEFT JOIN public.staff s ON s.id = f.created_by
      LEFT JOIN public.shifts sh ON sh.id = f.shift_id
      LEFT JOIN public.staff rs ON rs.id = f.resolved_by
      WHERE f.restaurant_id = v_rest
        AND (p_status IS NULL OR f.status = p_status)
        AND (
          v_search IS NULL
          OR f.reference ILIKE '%' || v_search || '%'
          OR f.title ILIKE '%' || v_search || '%'
          OR f.body ILIKE '%' || v_search || '%'
          OR s.display_name ILIKE '%' || v_search || '%'
        )
      ORDER BY f.created_at DESC
      LIMIT greatest(coalesce(p_limit, 50), 1)
      OFFSET greatest(coalesce(p_offset, 0), 0)
    ) sub
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_ops_feedback_status(
  p_id uuid,
  p_status text,
  p_resolution_note text DEFAULT NULL,
  p_resolved_in_version text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_row public.ops_feedback%ROWTYPE;
BEGIN
  IF p_status NOT IN ('new', 'in_review', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  SELECT * INTO v_row FROM public.ops_feedback
  WHERE id = p_id AND restaurant_id = v_rest
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  UPDATE public.ops_feedback
  SET status = p_status,
      updated_at = now(),
      resolution_note = CASE
        WHEN p_status IN ('resolved', 'closed')
          THEN coalesce(nullif(trim(coalesce(p_resolution_note, '')), ''), resolution_note)
        ELSE resolution_note
      END,
      resolved_in_version = CASE
        WHEN p_status IN ('resolved', 'closed')
          THEN coalesce(nullif(trim(coalesce(p_resolved_in_version, '')), ''), resolved_in_version)
        ELSE resolved_in_version
      END,
      resolved_at = CASE
        WHEN p_status IN ('resolved', 'closed') AND resolved_at IS NULL THEN now()
        ELSE resolved_at
      END,
      resolved_by = CASE
        WHEN p_status IN ('resolved', 'closed') THEN coalesce(resolved_by, v_actor)
        ELSE resolved_by
      END,
      closed_at = CASE
        WHEN p_status = 'closed' THEN coalesce(closed_at, now())
        ELSE closed_at
      END
  WHERE id = p_id;

  PERFORM public.log_audit_event(
    v_rest, 'ops_feedback.status', NULL, v_actor, 'ops_feedback', p_id, NULL,
    jsonb_build_object('status', p_status, 'resolved_in_version', p_resolved_in_version)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.add_ops_feedback_comment(p_feedback_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.m4_require_manager();
  v_actor uuid := public.auth_staff_id();
  v_id uuid;
BEGIN
  IF length(trim(coalesce(p_body, ''))) < 1 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ops_feedback WHERE id = p_feedback_id AND restaurant_id = v_rest
  ) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

  INSERT INTO public.ops_feedback_comments (feedback_id, restaurant_id, body, created_by)
  VALUES (p_feedback_id, v_rest, trim(p_body), v_actor)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_ops_feedback_comments(p_feedback_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rest uuid := public.auth_restaurant_id();
BEGIN
  IF v_rest IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.is_owner_or_manager() THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'body', c.body,
      'created_at', c.created_at,
      'created_by_name', s.display_name
    ) ORDER BY c.created_at)
    FROM public.ops_feedback_comments c
    LEFT JOIN public.staff s ON s.id = c.created_by
    WHERE c.feedback_id = p_feedback_id AND c.restaurant_id = v_rest
  ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_ops_feedback(text, text, text, text, text, text, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_ops_feedback_admin(text, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_ops_feedback_status(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_ops_feedback_comment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_ops_feedback_comments(uuid) TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.ops_feedback;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
