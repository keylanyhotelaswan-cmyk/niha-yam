-- HOTFIX: Production printing stopped — claim_print_jobs returned [].
-- Cause: print_ops_settings.is_test_environment=true with testing_print_enabled=false
-- (Testing claim-gate applied on Production after m6_bootstrap_test_print_environment).
--
-- Clear the test flag. On Testing, Print Center → Diagnostics re-runs bootstrap
-- and restores the Testing gate automatically.

UPDATE public.print_ops_settings
SET
  is_test_environment = false,
  updated_at = now()
WHERE is_test_environment = true;

COMMENT ON TABLE public.print_ops_settings IS
  'Per-restaurant print ops flags. Keep is_test_environment=false on Production. Mark true only via m6_bootstrap_test_print_environment on Testing.';
