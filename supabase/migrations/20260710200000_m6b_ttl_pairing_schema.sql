-- M6B: TTL, expired, print settings, pairing, delivery honesty (BP-12..14)
-- Feature freeze: only approved M6B plan items.

-- ---------------------------------------------------------------------------
-- Enum: expired + delivery
-- ---------------------------------------------------------------------------
ALTER TYPE public.print_job_status ADD VALUE IF NOT EXISTS 'expired';

DO $$ BEGIN
  CREATE TYPE public.print_delivery AS ENUM ('transport_ack', 'device_confirmed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- print_settings (TTL + future Print Center knobs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.print_settings (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  -- 0 = never; else minutes (2, 5, 10 typical)
  print_job_ttl_minutes int NOT NULL DEFAULT 5
    CONSTRAINT chk_print_ttl CHECK (print_job_ttl_minutes = 0 OR print_job_ttl_minutes IN (2, 5, 10)),
  default_copies int NOT NULL DEFAULT 1,
  open_cash_drawer boolean NOT NULL DEFAULT true,
  auto_cut boolean NOT NULL DEFAULT true,
  paper_width_mm int NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58, 80)),
  show_qr_on_receipt boolean NOT NULL DEFAULT false,
  kitchen_show_prices boolean NOT NULL DEFAULT false,
  thank_you_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.print_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS print_settings_select ON public.print_settings;
CREATE POLICY print_settings_select ON public.print_settings FOR SELECT TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

INSERT INTO public.print_settings (restaurant_id)
SELECT id FROM public.restaurants
ON CONFLICT (restaurant_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Pairing codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.print_bridge_pair_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants (id) ON DELETE RESTRICT,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pair_code_active UNIQUE (restaurant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_pair_codes_lookup
  ON public.print_bridge_pair_codes (code, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.print_bridge_pair_codes ENABLE ROW LEVEL SECURITY;
-- no direct client select of codes after create (RPC returns once)

-- ---------------------------------------------------------------------------
-- Extend bridges + jobs
-- ---------------------------------------------------------------------------
ALTER TABLE public.print_bridges
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS token_prefix text;

ALTER TABLE public.printers
  ADD COLUMN IF NOT EXISTS bridge_id uuid REFERENCES public.print_bridges (id) ON DELETE SET NULL;

ALTER TABLE public.print_jobs
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery public.print_delivery;

ALTER TABLE public.print_attempts
  ADD COLUMN IF NOT EXISTS delivery public.print_delivery;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.m6_ttl_minutes(p_rest uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT print_job_ttl_minutes FROM public.print_settings WHERE restaurant_id = p_rest),
    5
  );
$$;

CREATE OR REPLACE FUNCTION public.m6_compute_expires_at(p_rest uuid, p_from timestamptz DEFAULT now())
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ttl int;
BEGIN
  v_ttl := public.m6_ttl_minutes(p_rest);
  IF v_ttl IS NULL OR v_ttl <= 0 THEN
    RETURN NULL; -- never
  END IF;
  RETURN p_from + make_interval(mins => v_ttl);
END; $$;

CREATE OR REPLACE FUNCTION public.m6_print_jobs_bi_expires()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := public.m6_compute_expires_at(NEW.restaurant_id, coalesce(NEW.created_at, now()));
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_print_jobs_expires ON public.print_jobs;
CREATE TRIGGER trg_print_jobs_expires
  BEFORE INSERT ON public.print_jobs
  FOR EACH ROW EXECUTE FUNCTION public.m6_print_jobs_bi_expires();

CREATE OR REPLACE FUNCTION public.m6_expire_stale_print_jobs(p_rest uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.print_jobs j
  SET status = 'expired',
      claimed_by = NULL,
      claimed_at = NULL,
      last_error = coalesce(j.last_error, 'TTL_EXPIRED'),
      updated_at = now()
  WHERE (p_rest IS NULL OR j.restaurant_id = p_rest)
    AND j.expires_at IS NOT NULL
    AND j.expires_at < now()
    AND j.status IN ('pending', 'claimed', 'printing', 'retry_wait');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN coalesce(v_count, 0);
END; $$;

CREATE OR REPLACE FUNCTION public.m6_hash_token(p_token text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.m6_require_bridge_token(p_token text)
RETURNS public.print_bridges LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_b public.print_bridges%ROWTYPE;
BEGIN
  IF length(trim(coalesce(p_token, ''))) < 16 THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT * INTO v_b FROM public.print_bridges
  WHERE token_hash = public.m6_hash_token(trim(p_token)) AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  RETURN v_b;
END; $$;

-- Refresh order print status: treat expired like failed for aggregate
CREATE OR REPLACE FUNCTION public.m6_refresh_order_print_status(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pending int;
  v_failed int;
  v_done int;
  v_total int;
BEGIN
  SELECT
    count(*) FILTER (WHERE status IN ('pending', 'claimed', 'printing', 'retry_wait')),
    count(*) FILTER (WHERE status IN ('failed', 'expired')),
    count(*) FILTER (WHERE status = 'completed'),
    count(*) FILTER (WHERE status NOT IN ('cancelled'))
  INTO v_pending, v_failed, v_done, v_total
  FROM public.print_jobs
  WHERE order_id = p_order_id;

  IF v_total = 0 THEN
    UPDATE public.orders SET print_status = 'not_needed' WHERE id = p_order_id;
  ELSIF v_failed > 0 AND v_pending = 0 AND v_done = 0 THEN
    UPDATE public.orders SET print_status = 'failed' WHERE id = p_order_id;
  ELSIF v_pending > 0 THEN
    UPDATE public.orders SET print_status = 'pending' WHERE id = p_order_id;
  ELSIF v_done > 0 AND v_pending = 0 THEN
    UPDATE public.orders SET print_status = 'done' WHERE id = p_order_id;
  ELSIF v_failed > 0 AND v_pending = 0 THEN
    UPDATE public.orders SET print_status = 'failed' WHERE id = p_order_id;
  END IF;
END; $$;

NOTIFY pgrst, 'reload schema';
