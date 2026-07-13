-- OC v1.1 enums must commit before any function uses the new values (PG 55P04)
ALTER TYPE public.staff_role ADD VALUE IF NOT EXISTS 'remote_operator';
ALTER TYPE public.print_job_kind ADD VALUE IF NOT EXISTS 'ops_message';
