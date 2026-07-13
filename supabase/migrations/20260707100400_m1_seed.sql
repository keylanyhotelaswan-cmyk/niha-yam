-- M1 seed: structural data only (restaurant + branch). No staff, no auth users.

INSERT INTO public.restaurants (id, name, slug, currency_code, timezone)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'NIHA Demo Restaurant',
  'niha-demo',
  'SAR',
  'Asia/Riyadh'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.branches (id, restaurant_id, name, code)
VALUES (
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'Main Branch',
  'MAIN'
)
ON CONFLICT (restaurant_id, code) DO NOTHING;
