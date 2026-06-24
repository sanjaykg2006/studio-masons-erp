-- Studio-Masons ERP — Design Department module (Brief stage)
-- Run in the Supabase SQL Editor AFTER 0005_permission_verbs.sql.
--
-- WHAT THIS ADDS
--   * Projects with a lifecycle (draft -> brief_in_progress -> brief_approved
--     -> finalised). A project only enters the company DB as "finalised".
--   * Per-project membership: a user is added to a project AS a role, and their
--     verbs on THAT project come from that role. Department-wide roles (Director,
--     Senior Project Architect) get their reach from their GLOBAL role instead.
--   * Versioned questionnaire templates (the project brief). Editing a template
--     publishes a new version; briefs already filled keep the version they used.
--   * Briefs = a project's answers to a template version, lockable on approval.
--
-- PERMISSION RESOURCES (sub-resources of the 'design' module)
--   design.project | design.brief | design.template | design.member
--
-- ENFORCEMENT
--   has_project_permission(project, resource, action) is the project-aware
--   boundary used by RLS: true if the user's GLOBAL role grants it (department
--   wide) OR they hold it via membership on that specific project. Templates are
--   a shared library, gated by the ordinary global has_permission().

-- 0. Backfill admin's wildcard with the new governance verbs --------------------
-- (0005 only ADDED the enum values; they couldn't be USED in that transaction.)
insert into public.role_permissions (role_id, resource, action)
select r.id, '*', a.action
from public.roles r
cross join (
  select unnest(enum_range(null::public.app_action)) as action
) a
where r.key = 'admin'
on conflict do nothing;

-- 1. Status / discipline vocabularies -----------------------------------------
do $$ begin
  create type public.design_project_status as enum
    ('draft', 'brief_in_progress', 'brief_approved', 'finalised');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.design_brief_status as enum
    ('in_progress', 'in_review', 'approved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.design_template_status as enum
    ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.design_discipline as enum ('interior', 'mep');
exception when duplicate_object then null; end $$;

-- 2. Projects + membership ----------------------------------------------------
create table if not exists public.design_projects (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,                          -- e.g. 'HCA' (optional)
  name         text not null,
  client       text,
  location     text,
  status       public.design_project_status not null default 'draft',
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  finalised_at timestamptz
);

-- A user belongs to a project AS a role. Their verbs on the project derive from
-- that role (see has_project_permission). PK = one membership row per user/project.
create table if not exists public.design_project_members (
  project_id uuid not null references public.design_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role_id    uuid not null references public.roles (id),
  added_by   uuid references auth.users (id),
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- 3. Versioned templates ------------------------------------------------------
create table if not exists public.design_templates (
  id         uuid primary key default gen_random_uuid(),
  key        text unique not null,                   -- 'interior', 'mep_office', ...
  label      text not null,
  discipline public.design_discipline not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.design_template_versions (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.design_templates (id) on delete cascade,
  version_no  int  not null,
  status      public.design_template_status not null default 'draft',
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  unique (template_id, version_no)
);

-- The answer columns a version exposes (preserves each questionnaire's native
-- shape: Interior = Yes/No + Response + Remarks; MEP = Option-1 / Option-2 /
-- Consultant's Recommendation / Client Response). `kind` drives the input type.
create table if not exists public.design_template_columns (
  id         uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.design_template_versions (id) on delete cascade,
  sort       int  not null default 0,
  key        text not null,                          -- stable per version, e.g. 'response'
  label      text not null,
  kind       text not null default 'text',           -- 'text' | 'longtext' | 'yes_no' | 'option'
  unique (version_id, key)
);

create table if not exists public.design_template_sections (
  id         uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.design_template_versions (id) on delete cascade,
  sort       int  not null default 0,
  title      text not null
);

create table if not exists public.design_template_questions (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.design_template_sections (id) on delete cascade,
  sort       int  not null default 0,
  text       text not null
);

-- 4. Briefs (a project's answers to a template version) -----------------------
create table if not exists public.design_briefs (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.design_projects (id) on delete cascade,
  template_id         uuid not null references public.design_templates (id),
  template_version_id uuid not null references public.design_template_versions (id),
  discipline          public.design_discipline not null,
  status              public.design_brief_status not null default 'in_progress',
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  approved_by         uuid references auth.users (id),
  approved_at         timestamptz,
  unique (project_id, template_id)
);

-- One row per (brief, question); `values` is keyed by the version's column keys.
create table if not exists public.design_brief_answers (
  brief_id    uuid not null references public.design_briefs (id) on delete cascade,
  question_id uuid not null references public.design_template_questions (id) on delete cascade,
  values      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (brief_id, question_id)
);

-- 5. THE PROJECT-AWARE BOUNDARY ----------------------------------------------
create or replace function public.has_project_permission(
  p_project  uuid,
  p_resource text,
  p_action   public.app_action
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (a) department-wide: the caller's GLOBAL role grants it everywhere
    public.has_permission(p_resource, p_action)
    -- (b) project-scoped: granted via the caller's membership on THIS project
    or exists (
      select 1
      from public.design_project_members m
      join public.role_permissions rp on rp.role_id = m.role_id
      where m.project_id = p_project
        and m.user_id = auth.uid()
        and rp.action = p_action
        and rp.resource in (p_resource, '*')
    );
$$;

-- The caller's effective verbs on one project (global ∪ membership). The app
-- loads this to gate per-project UI and server actions. SECURITY DEFINER, and
-- only ever returns the CALLER's own grants.
create or replace function public.my_project_permissions(p_project uuid)
returns table (resource text, action public.app_action)
language sql
stable
security definer
set search_path = public
as $$
  select rp.resource, rp.action
  from public.profiles p
  join public.role_permissions rp on rp.role_id = p.role_id
  where p.id = auth.uid()
  union
  select rp.resource, rp.action
  from public.design_project_members m
  join public.role_permissions rp on rp.role_id = m.role_id
  where m.project_id = p_project and m.user_id = auth.uid();
$$;

-- 6. RLS ----------------------------------------------------------------------
alter table public.design_projects          enable row level security;
alter table public.design_project_members   enable row level security;
alter table public.design_templates         enable row level security;
alter table public.design_template_versions enable row level security;
alter table public.design_template_columns  enable row level security;
alter table public.design_template_sections enable row level security;
alter table public.design_template_questions enable row level security;
alter table public.design_briefs            enable row level security;
alter table public.design_brief_answers     enable row level security;

-- Projects: per-row, project-scoped. Creating is a department-level capability.
drop policy if exists "design_projects_select" on public.design_projects;
create policy "design_projects_select" on public.design_projects
  for select using (has_project_permission(id, 'design.project', 'read'));

drop policy if exists "design_projects_insert" on public.design_projects;
create policy "design_projects_insert" on public.design_projects
  for insert with check (has_permission('design.project', 'create'));

drop policy if exists "design_projects_update" on public.design_projects;
create policy "design_projects_update" on public.design_projects
  for update using (
    has_project_permission(id, 'design.project', 'update')
    or has_project_permission(id, 'design.project', 'approve')
  )
  with check (
    has_project_permission(id, 'design.project', 'update')
    or has_project_permission(id, 'design.project', 'approve')
  );

drop policy if exists "design_projects_delete" on public.design_projects;
create policy "design_projects_delete" on public.design_projects
  for delete using (has_project_permission(id, 'design.project', 'delete'));

-- Members: if you can see the project you can see its members; managing is gated.
drop policy if exists "design_members_select" on public.design_project_members;
create policy "design_members_select" on public.design_project_members
  for select using (has_project_permission(project_id, 'design.project', 'read'));

drop policy if exists "design_members_write" on public.design_project_members;
create policy "design_members_write" on public.design_project_members
  for all using (has_project_permission(project_id, 'design.member', 'manage'))
  with check (has_project_permission(project_id, 'design.member', 'manage'));

-- Templates (and their children): a shared library, gated globally.
drop policy if exists "design_templates_select" on public.design_templates;
create policy "design_templates_select" on public.design_templates
  for select using (has_permission('design.template', 'read'));
drop policy if exists "design_templates_insert" on public.design_templates;
create policy "design_templates_insert" on public.design_templates
  for insert with check (has_permission('design.template', 'create'));
drop policy if exists "design_templates_update" on public.design_templates;
create policy "design_templates_update" on public.design_templates
  for update using (has_permission('design.template', 'update'))
  with check (has_permission('design.template', 'update'));
drop policy if exists "design_templates_delete" on public.design_templates;
create policy "design_templates_delete" on public.design_templates
  for delete using (has_permission('design.template', 'delete'));

-- Template children: read with template:read, mutate with template:update.
do $$
declare t text;
begin
  foreach t in array array[
    'design_template_versions',
    'design_template_columns',
    'design_template_sections',
    'design_template_questions'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (has_permission(''design.template'', ''read''))',
      t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all using (has_permission(''design.template'', ''update'')) with check (has_permission(''design.template'', ''update''))',
      t || '_write', t);
  end loop;
end $$;

-- Briefs: project-scoped via the parent project.
drop policy if exists "design_briefs_select" on public.design_briefs;
create policy "design_briefs_select" on public.design_briefs
  for select using (has_project_permission(project_id, 'design.brief', 'read'));
drop policy if exists "design_briefs_insert" on public.design_briefs;
create policy "design_briefs_insert" on public.design_briefs
  for insert with check (has_project_permission(project_id, 'design.brief', 'create'));
drop policy if exists "design_briefs_update" on public.design_briefs;
create policy "design_briefs_update" on public.design_briefs
  for update using (
    has_project_permission(project_id, 'design.brief', 'update')
    or has_project_permission(project_id, 'design.brief', 'review')
    or has_project_permission(project_id, 'design.brief', 'approve')
  )
  with check (
    has_project_permission(project_id, 'design.brief', 'update')
    or has_project_permission(project_id, 'design.brief', 'review')
    or has_project_permission(project_id, 'design.brief', 'approve')
  );
drop policy if exists "design_briefs_delete" on public.design_briefs;
create policy "design_briefs_delete" on public.design_briefs
  for delete using (has_project_permission(project_id, 'design.brief', 'delete'));

-- Brief answers: inherit the brief's project context.
drop policy if exists "design_brief_answers_select" on public.design_brief_answers;
create policy "design_brief_answers_select" on public.design_brief_answers
  for select using (exists (
    select 1 from public.design_briefs b
    where b.id = brief_id
      and has_project_permission(b.project_id, 'design.brief', 'read')
  ));
drop policy if exists "design_brief_answers_write" on public.design_brief_answers;
create policy "design_brief_answers_write" on public.design_brief_answers
  for all using (exists (
    select 1 from public.design_briefs b
    where b.id = brief_id
      and has_project_permission(b.project_id, 'design.brief', 'update')
  ))
  with check (exists (
    select 1 from public.design_briefs b
    where b.id = brief_id
      and has_project_permission(b.project_id, 'design.brief', 'update')
  ));

-- 7. LOCK — no direct editing of an approved brief ----------------------------
-- Framework rule: approved deliverables are read-only. Once a brief is approved,
-- its answers can't be changed by end users (service role / SQL bypass auth.uid).
create or replace function public.guard_brief_answer_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_status public.design_brief_status;
begin
  select status into v_status from public.design_briefs
  where id = coalesce(new.brief_id, old.brief_id);
  if v_status = 'approved' and auth.uid() is not null then
    raise exception 'This brief is approved and locked for editing';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists design_brief_answers_lock on public.design_brief_answers;
create trigger design_brief_answers_lock
  before insert or update or delete on public.design_brief_answers
  for each row execute function public.guard_brief_answer_lock();

-- 8. Register the Design department + its module resources --------------------
insert into public.departments (key, label, description, is_system)
values ('design', 'Design Department',
        'Architecture & design: projects, briefs, GFC issue and collaboration.', false)
on conflict (key) do nothing;

-- Make the four design sub-resources assignable to the Design department's roles
-- (the 0004 guard trigger only lets a department role hold its own modules).
insert into public.department_modules (department_id, module_id)
select d.id, m.module_id
from public.departments d
cross join (values
  ('design.project'), ('design.brief'), ('design.template'), ('design.member')
) as m(module_id)
where d.key = 'design'
on conflict do nothing;

-- They are department-specific, not general.
insert into public.module_settings (module_id, is_general) values
  ('design.project', false),
  ('design.brief', false),
  ('design.template', false),
  ('design.member', false)
on conflict (module_id) do nothing;
