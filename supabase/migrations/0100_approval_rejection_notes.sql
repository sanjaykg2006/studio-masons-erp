-- 0100 — Show the raiser why their item was turned down.
--
-- Every Reject / Refuse / Return asks for a reason and approval_decide stores
-- it on approval_decisions, but only Access Control readers can read that
-- table, so the reason never reached the person who has to act on it. This
-- hands back the reason for items whose request currently stands rejected
-- (a resubmit replaces the request, so a fixed item stops showing it).
-- Item ids come off screens the caller could already read.
create or replace function public.approval_rejection_notes(p_flow text, p_items uuid[])
returns table (item_id uuid, note text, decided_by_name text, decided_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select distinct on (r.item_id)
         r.item_id, d.note, coalesce(p.full_name, p.email), d.decided_at
    from public.approval_requests r
    join public.approval_decisions d on d.request_id = r.id and d.decision = 'rejected'
    left join public.profiles p on p.id = d.decided_by
   where auth.uid() is not null
     and r.flow_id = p_flow
     and r.item_id = any (p_items)
     and r.status = 'rejected'
   order by r.item_id, d.decided_at desc;
$$;

revoke execute on function public.approval_rejection_notes(text, uuid[]) from public, anon;
grant execute on function public.approval_rejection_notes(text, uuid[]) to authenticated;
