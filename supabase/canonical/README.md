# Canonical SQL fragments

Editable source-of-truth SQL for functions that used to be redefined in many
feature migrations.

| File | Function | Rule |
| --- | --- | --- |
| `list_orders_for_pos.sql` | `public.list_orders_for_pos` | Edit here, then ship a dedicated migration that `CREATE OR REPLACE`s the same body |

Do **not** paste a full `list_orders_for_pos` into unrelated feature migrations.
Historical migrations under `supabase/migrations/` remain immutable.
