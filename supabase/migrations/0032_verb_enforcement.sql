-- Studio-Masons ERP — verb enforcement: freeze/finalise need approve at the DB
-- Run AFTER 0031_rbac_hardening.sql.
--
-- THE GAP (from the verb audit)
--   Freeze, Unfreeze and Finalise are meant to need the "approve" verb. The
--   server actions do check it — but the projects table's write rule allows the
--   plain "update" verb, and row rules can't gate individual columns. So someone
--   with only project:update could set phase / frozen_at / finalised state
--   directly (bypassing the app) and skip the approve gate — re-opening a frozen
--   project or finalising without sign-off.
--
-- THE FIX
--   A column guard: changing a project's freeze/finalise state requires the
--   "approve" verb, no matter how the change arrives. Ordinary edits (name, etc.)
--   still only need "update". Brief approval (which sets status = brief_approved)
--   is untouched, so nothing legitimate breaks.

create or replace function public.guard_project_governance()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Trusted server contexts (service role / SQL editor / SSO) have no auth.uid()
  -- and already bypass RLS; only guard real end users.
  if auth.uid() is null then
    return new;
  end if;

  if (
        new.phase        is distinct from old.phase
     or new.frozen_at    is distinct from old.frozen_at
     or new.frozen_by    is distinct from old.frozen_by
     or new.finalised_at is distinct from old.finalised_at
     or (new.status is distinct from old.status and new.status = 'finalised')
     )
     and not public.has_project_permission(new.id, 'project', 'approve') then
    raise exception
      'Changing a project''s freeze or finalise state needs approve permission';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_guard_governance on public.projects;
create trigger projects_guard_governance
  before update on public.projects
  for each row execute function public.guard_project_governance();
