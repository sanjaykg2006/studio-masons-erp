-- 0099 — Budget lines can't carry a negative quantity or rate.
--
-- A -5 qty line saved fine and pulled the package total down. The action now
-- refuses it ("Quantity and rate must be zero or more."); this is the backstop.
-- NOT VALID so any line already saved isn't re-checked, only new writes.
alter table public.procurement_budget_lines
  add constraint procurement_budget_lines_not_negative
  check (qty >= 0 and rate >= 0) not valid;
