-- Fix for 0017: migration 0016 switched public.users' SELECT grant for
-- authenticated/anon from "whole table" to an explicit column allow-list.
-- scheduled_plan (added in 0017, after 0016 ran) was never added to that
-- list, so any query selecting it — including /settings/billing's own
-- profile query — got a flat 403 "permission denied for table users" and
-- the whole row came back null. scheduled_plan isn't sensitive (it's just
-- "which plan applies next cycle", not a credential like the billing key),
-- so it belongs in the same allow-list as the other subscription fields.
grant select (scheduled_plan) on public.users to authenticated, anon;
