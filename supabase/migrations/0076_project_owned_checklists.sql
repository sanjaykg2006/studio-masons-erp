-- Studio-Masons ERP — every project owns its checklist; the company keeps a default
-- Run AFTER 0075_one_copy_of_the_department_role_rules.sql.
--
-- WHAT WAS WRONG
--   One company-wide list of steps (design_stage_steps) drove the progress bars
--   on EVERY project, and it was readable only behind has_design_access —
--   design.template:read or design.folder:read. A Project Director holds
--   neither, so the list came back empty for them and getProjectProgress found
--   zero steps in every stage: the tracker rendered at 0%, looking like a
--   project with no progress rather than a permissions problem.
--
--   It was also the wrong shape. Projects do not all run the same steps, but
--   one shared list meant editing it re-scored every project at once, and the
--   list lived inside Design's settings even though Procurement, Finance and
--   Project Management projects were measured against it.
--
-- WHAT THIS DOES
--   * project_steps stops being a set of ticks against a shared list and
--     becomes the project's OWN checklist: it carries the stage, label and
--     order itself. Editing one project's checklist now affects that project
--     and nothing else.
--   * design_stage_steps is renamed project_step_templates — the company
--     DEFAULT, copied into each new project and otherwise inert. Editing it
--     changes what future projects start with, never an existing project.
--   * Every existing project is given the full current list, so today's
--     percentages are preserved exactly and nothing reads as 0%.
--
--   The Design-department gate disappears from the progress path entirely:
--   project_steps is already gated on has_project_permission(project,'project',
--   'read'/'update'), so anyone who can see a project sees its progress, and
--   anyone who can edit the project can change its checklist. No new rule.
--
--   The five stages stay fixed. They are the lifecycle the Design Freeze and
--   the phase model hang off, and the overall bar weights each at 20%.

-- ── 1. The shared list becomes the company default ──────────────────────────
alter table if exists public.design_stage_steps rename to project_step_templates;

comment on table public.project_step_templates is
  'The default checklist copied into a new project. Not read when scoring progress - each project owns its own steps.';

-- The old policies came across with the rename, still gated on Design.
drop policy if exists "design_stage_steps_select" on public.project_step_templates;
drop policy if exists "design_stage_steps_write"  on public.project_step_templates;

drop policy if exists "project_step_templates_select" on public.project_step_templates;
create policy "project_step_templates_select" on public.project_step_templates
  for select using (has_permission('project.template', 'read'));

drop policy if exists "project_step_templates_write" on public.project_step_templates;
create policy "project_step_templates_write" on public.project_step_templates
  for all using (has_permission('project.template', 'update'))
  with check (has_permission('project.template', 'update'));

-- ── 2. project_steps becomes the project's own checklist ────────────────────
alter table public.project_steps
  add column if not exists id    uuid not null default gen_random_uuid(),
  add column if not exists stage text,
  add column if not exists label text,
  add column if not exists sort  int not null default 0;

-- Carry across what the existing ticks were against.
update public.project_steps ps
   set stage = t.stage, label = t.label, sort = t.sort
  from public.project_step_templates t
 where t.id = ps.step_id
   and ps.stage is null;

-- Give every existing project the WHOLE list, not just the steps already
-- ticked, so a project's denominator is unchanged and nothing drops to 0%.
insert into public.project_steps (project_id, step_id, stage, label, sort, done)
select p.id, t.id, t.stage, t.label, t.sort, false
from public.projects p
cross join public.project_step_templates t
where not exists (
  select 1 from public.project_steps ps
  where ps.project_id = p.id and ps.step_id = t.id
);

-- Anything still unfilled had no template row behind it; keep it rather than
-- drop someone's tick, parked in the first stage for a human to sort out.
update public.project_steps
   set stage = coalesce(stage, 'brief_concept'),
       label = coalesce(label, '(step removed from the template)')
 where stage is null or label is null;

alter table public.project_steps
  alter column stage set not null,
  alter column label set not null;

-- The primary key was (project_id, step_id). A project's own step needs its own
-- identity, and two steps may legitimately share a name.
alter table public.project_steps drop constraint if exists design_project_steps_pkey;
alter table public.project_steps drop constraint if exists project_steps_pkey;
alter table public.project_steps add primary key (id);

-- step_id stops being a parent and becomes provenance: which template step this
-- came from, if any. Deleting a template step must never delete project work.
do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.project_steps'::regclass
    and contype = 'f'
    and confrelid = 'public.project_step_templates'::regclass;
  if c is not null then
    execute format('alter table public.project_steps drop constraint %I', c);
  end if;
end $$;

alter table public.project_steps rename column step_id to template_step_id;
alter table public.project_steps alter column template_step_id drop not null;
alter table public.project_steps
  add constraint project_steps_template_step_fkey
  foreign key (template_step_id) references public.project_step_templates (id)
  on delete set null;

alter table public.project_steps drop constraint if exists project_steps_stage_check;
alter table public.project_steps
  add constraint project_steps_stage_check check (stage in
    ('brief_concept','client_review','design_freeze','gfc_release','site_execution'));

create index if not exists project_steps_project_idx
  on public.project_steps (project_id, stage, sort);

-- ── 3. A new project starts from the company default ───────────────────────
create or replace function public.seed_project_checklist()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.project_steps (project_id, template_step_id, stage, label, sort, done)
  select new.id, t.id, t.stage, t.label, t.sort, false
  from public.project_step_templates t;
  return new;
end;
$$;

drop trigger if exists projects_seed_checklist on public.projects;
create trigger projects_seed_checklist
  after insert on public.projects
  for each row execute function public.seed_project_checklist();

-- ── 4. The current stage now reads the project's own checklist ─────────────
create or replace function public.design_project_stage(p_project uuid)
returns text
language sql stable security definer set search_path = public
as $$
  with ord as (
    select * from (values
      ('brief_concept',1),('client_review',2),('design_freeze',3),
      ('gfc_release',4),('site_execution',5)
    ) as s(stage, n)
  ),
  stats as (
    select ps.stage,
           count(*) as total,
           count(*) filter (where coalesce(ps.done, false)) as done
    from public.project_steps ps
    where ps.project_id = p_project
    group by ps.stage
  )
  select coalesce(
    (select st.stage from stats st join ord o on o.stage = st.stage
      where st.total > 0 and st.done < st.total
      order by o.n limit 1),
    'site_execution');
$$;
