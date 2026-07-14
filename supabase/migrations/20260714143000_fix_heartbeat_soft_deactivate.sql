-- Follow-up: do NOT soft-deactivate unrelated Bridges on heartbeat.
-- That bricked second-PC tokens (PERMISSION_DENIED) while the first stayed online.
-- Only retire peers that share the same device_name (same machine re-pair).

CREATE OR REPLACE FUNCTION public.bridge_heartbeat(
  p_token text,
  p_device_name text DEFAULT NULL,
  p_windows_username text DEFAULT NULL,
  p_version text DEFAULT NULL,
  p_restarted boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_b public.print_bridges%ROWTYPE;
  v_rest_name text;
  v_healed int := 0;
  v_device text;
BEGIN
  v_b := public.m6_require_bridge_token(p_token);
  v_device := nullif(trim(coalesce(p_device_name, '')), '');

  UPDATE public.print_bridges SET
    device_name = coalesce(v_device, device_name),
    windows_username = coalesce(nullif(trim(coalesce(p_windows_username, '')), ''), windows_username),
    version = coalesce(nullif(trim(coalesce(p_version, '')), ''), version),
    last_heartbeat_at = now(),
    last_connected_at = now(),
    last_restart_at = CASE WHEN p_restarted THEN now() ELSE last_restart_at END,
    updated_at = now()
  WHERE id = v_b.id;

  -- Same-machine peers only (never deactivate a different PC's Bridge)
  IF coalesce(v_device, v_b.device_name) IS NOT NULL THEN
    UPDATE public.print_bridges
    SET is_active = false, updated_at = now()
    WHERE restaurant_id = v_b.restaurant_id
      AND id <> v_b.id
      AND is_active
      AND device_name IS NOT NULL
      AND lower(device_name) = lower(coalesce(v_device, v_b.device_name));
  END IF;

  UPDATE public.printers p
  SET bridge_id = v_b.id, updated_at = now()
  WHERE p.restaurant_id = v_b.restaurant_id
    AND (
      p.bridge_id IS NULL
      OR p.bridge_id = v_b.id
      OR NOT EXISTS (
        SELECT 1 FROM public.print_bridges xb
        WHERE xb.id = p.bridge_id
          AND xb.is_active
          AND xb.last_heartbeat_at IS NOT NULL
          AND xb.last_heartbeat_at > now() - interval '45 seconds'
      )
    );
  GET DIAGNOSTICS v_healed = ROW_COUNT;

  SELECT name INTO v_rest_name FROM public.restaurants WHERE id = v_b.restaurant_id;

  RETURN jsonb_build_object(
    'bridge_id', v_b.id,
    'restaurant_id', v_b.restaurant_id,
    'restaurant_name', coalesce(nullif(trim(v_rest_name), ''), 'المطعم'),
    'printers_healed', coalesce(v_healed, 0)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.bridge_heartbeat(text, text, text, text, boolean) TO anon, authenticated;

-- Restore Bridges we soft-deactivated incorrectly (still have a valid token hash)
UPDATE public.print_bridges
SET is_active = true, updated_at = now()
WHERE id = '84eb087f-4a1c-46e2-a32f-9183f7530f5d'
  AND is_active = false;

NOTIFY pgrst, 'reload schema';
