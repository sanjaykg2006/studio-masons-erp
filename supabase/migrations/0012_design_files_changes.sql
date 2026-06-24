-- Studio-Masons ERP — Design Department: files, locking, GFC issue, change orders
-- Run AFTER 0011_design_folders_progress.sql.
--
-- WHAT THIS ADDS (Phases 2–5 of the controlled-folder plan)
--   * design_files — file metadata living in a project's folders, with versions
--     and an is_current flag (the GFC "latest issued" set).
--   * A private Storage bucket 'design-files'. Bytes are read/written by the
--     service-role client INSIDE permission-checked server actions; the metadata
--     row in design_files is the RLS boundary.
--   * Folder-capability helpers: the caller's effective view/edit/approve on a
--     folder FOR A PROJECT (their project membership role(s) ∪ a department-wide
--     global role, matched against the design_folder_access matrix; admin '*' wins).
--   * Stage-driven locking: design_project_stage() derives the current stage from
--     the checklist; is_folder_locked() freezes Approved Design at Design Freeze
--     and GFC Issued at GFC Release. Approvers (design head) can still write.
--   * design_change_requests — the Change Order Register: the controlled door for
--     altering frozen/issued work after a freeze.

-- 1. Folder-capability + stage helpers ----------------------------------------

-- The caller's highest capability rank on a folder for a project.
-- 0 none · 1 view · 2 edit · 3 approve. Admin (global '*') is always 3.
create or replace function public.design_folder_rank(
  p_project uuid,
  p_folder  text
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    -- admin wildcard short-circuit
    case when exists (
      select 1 from public.profiles p
      join public.role_permissions rp on rp.role_id = p.role_id
      where p.id = auth.uid() and rp.resource = '*'
    ) then 3 else 0 end,
    -- the matrix, against the caller's department-wide global role ∪ project roles
    coalesce((
      select max(case fa.capability
                   when 'approve' then 3 when 'edit' then 2 when 'view' then 1 else 0 end)
      from public.design_folder_access fa
      where fa.folder_key = p_folder
        and fa.role_id in (
          select p.role_id
          from public.profiles p
          join public.roles r on r.id = p.role_id
          where p.id = auth.uid() and r.is_department_wide
          union
          select m.role_id
          from public.design_project_members m
          where m.project_id = p_project and m.user_id = auth.uid()
        )
    ), 0)
  );
$$;

create or replace function public.has_folder_capability(
  p_project uuid,
  p_folder  text,
  p_min     text   -- 'view' | 'edit' | 'approve'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.design_folder_rank(p_project, p_folder) >=
    case p_min when 'approve' then 3 when 'edit' then 2 else 1 end;
$$;

-- The project's current stage, derived from the checklist (first stage with
-- steps that isn't fully complete; 'site_execution' once everything is done).
create or replace function public.design_project_stage(p_project uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with ord as (
    select * from (values
      ('brief_concept',1),('client_review',2),('design_freeze',3),
      ('gfc_release',4),('site_execution',5)
    ) as s(stage, n)
  ),
  stats as (
    select ss.stage,
           count(*) as total,
           count(*) filter (where coalesce(ps.done, false)) as done
    from public.design_stage_steps ss
    left join public.design_project_steps ps
      on ps.step_id = ss.id and ps.project_id = p_project
    group by ss.stage
  )
  select coalesce(
    (select st.stage from stats st join ord o on o.stage = st.stage
      where st.total > 0 and st.done < st.total
      order by o.n limit 1),
    'site_execution');
$$;

-- Is a folder frozen at the project's current stage? Approved Design locks from
-- Design Freeze; GFC Issued from GFC Release.
create or replace function public.is_folder_locked(
  p_project uuid,
  p_folder  text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_folder = 'approved_design' then
      public.design_project_stage(p_project) in ('design_freeze','gfc_release','site_execution')
    when p_folder = 'gfc_issued' then
      public.design_project_stage(p_project) in ('gfc_release','site_execution')
    else false
  end;
$$;

-- 2. Files --------------------------------------------------------------------
create table if not exists public.design_files (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.design_projects (id) on delete cascade,
  folder_key    text not null references public.design_folder_types (key),
  name          text not null,
  storage_path  text not null,
  mime_type     text,
  size_bytes    bigint,
  version_no    int  not null default 1,
  is_current    boolean not null default true,
  source_file_id uuid references public.design_files (id) on delete set null,
  uploaded_by   uuid references auth.users (id),
  created_at    timestamptz not null default now()
);

create index if not exists design_files_project_folder_idx
  on public.design_files (project_id, folder_key);

alter table public.design_files enable row level security;

-- Read: anyone with at least view on the folder for this project.
drop policy if exists "design_files_select" on public.design_files;
create policy "design_files_select" on public.design_files
  for select using (has_folder_capability(project_id, folder_key, 'view'));

-- Write: approvers always; editors only while the folder isn't locked.
drop policy if exists "design_files_insert" on public.design_files;
create policy "design_files_insert" on public.design_files
  for insert with check (
    has_folder_capability(project_id, folder_key, 'approve')
    or (has_folder_capability(project_id, folder_key, 'edit')
        and not is_folder_locked(project_id, folder_key))
  );

drop policy if exists "design_files_update" on public.design_files;
create policy "design_files_update" on public.design_files
  for update using (
    has_folder_capability(project_id, folder_key, 'approve')
    or (has_folder_capability(project_id, folder_key, 'edit')
        and not is_folder_locked(project_id, folder_key))
  )
  with check (
    has_folder_capability(project_id, folder_key, 'approve')
    or (has_folder_capability(project_id, folder_key, 'edit')
        and not is_folder_locked(project_id, folder_key))
  );

drop policy if exists "design_files_delete" on public.design_files;
create policy "design_files_delete" on public.design_files
  for delete using (
    has_folder_capability(project_id, folder_key, 'approve')
    or (has_folder_capability(project_id, folder_key, 'edit')
        and not is_folder_locked(project_id, folder_key))
  );

-- 3. Storage bucket (private; bytes accessed via service role in gated actions)
insert into storage.buckets (id, name, public)
values ('design-files', 'design-files', false)
on conflict (id) do nothing;

-- 4. Change Order Register ----------------------------------------------------
create table if not exists public.design_change_requests (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.design_projects (id) on delete cascade,
  folder_key    text references public.design_folder_types (key),
  title         text not null,
  reason        text,
  status        text not null default 'open' check (status in ('open','approved','rejected')),
  raised_by     uuid references auth.users (id),
  raised_at     timestamptz not null default now(),
  decided_by    uuid references auth.users (id),
  decided_at    timestamptz,
  decision_note text
);

create index if not exists design_change_requests_project_idx
  on public.design_change_requests (project_id);

alter table public.design_change_requests enable row level security;

-- Read / raise: anyone who can read the project. Decide: project approve.
drop policy if exists "design_change_requests_select" on public.design_change_requests;
create policy "design_change_requests_select" on public.design_change_requests
  for select using (has_project_permission(project_id, 'design.project', 'read'));

drop policy if exists "design_change_requests_insert" on public.design_change_requests;
create policy "design_change_requests_insert" on public.design_change_requests
  for insert with check (has_project_permission(project_id, 'design.project', 'read'));

drop policy if exists "design_change_requests_update" on public.design_change_requests;
create policy "design_change_requests_update" on public.design_change_requests
  for update using (has_project_permission(project_id, 'design.project', 'approve'))
  with check (has_project_permission(project_id, 'design.project', 'approve'));

-- 4b. The 12 folders for a project, with the caller's capability + lock state.
-- One round-trip for the folder list UI. rank: 0 none/1 view/2 edit/3 approve.
create or replace function public.design_project_folders(p_project uuid)
returns table (
  folder_key  text,
  label       text,
  sort        int,
  description text,
  rank        int,
  locked      boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select ft.key, ft.label, ft.sort, ft.description,
         public.design_folder_rank(p_project, ft.key),
         public.is_folder_locked(p_project, ft.key)
  from public.design_folder_types ft
  where public.has_project_permission(p_project, 'design.project', 'read')
  order by ft.sort;
$$;

-- 5. Grant the 'issue' verb on design.folder to the issuing roles -------------
-- Senior PA / Director issue the controlled GFC package. (admin holds '*'.)
insert into public.role_permissions (role_id, resource, action)
select r.id, 'design.folder', 'issue'::public.app_action
from public.roles r
where r.key in ('design_senior_pa', 'design_director')
on conflict do nothing;
