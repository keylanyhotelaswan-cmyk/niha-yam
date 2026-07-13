-- M1: RLS policies

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY restaurants_select_staff
  ON public.restaurants FOR SELECT
  TO authenticated
  USING (id = public.auth_restaurant_id());

CREATE POLICY restaurants_update_owner
  ON public.restaurants FOR UPDATE
  TO authenticated
  USING (
    id = public.auth_restaurant_id()
    AND EXISTS (
      SELECT 1 FROM public.staff_branches sb
      WHERE sb.staff_id = public.auth_staff_id() AND sb.role = 'owner'
    )
  );

CREATE POLICY branches_select_staff
  ON public.branches FOR SELECT
  TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY staff_select_same_restaurant
  ON public.staff FOR SELECT
  TO authenticated
  USING (restaurant_id = public.auth_restaurant_id());

CREATE POLICY staff_branches_select_same_restaurant
  ON public.staff_branches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = staff_branches.staff_id
        AND s.restaurant_id = public.auth_restaurant_id()
    )
  );

CREATE POLICY staff_invites_select_manager
  ON public.staff_invites FOR SELECT
  TO authenticated
  USING (
    restaurant_id = public.auth_restaurant_id()
    AND public.is_owner_or_manager()
  );

CREATE POLICY audit_log_select_manager
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (
    restaurant_id = public.auth_restaurant_id()
    AND public.is_owner_or_manager()
  );
