-- Run in Supabase SQL Editor as the project administrator. Safe to re-run.
begin;
create table if not exists public.tracker_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  constraint tracker_state_object check (jsonb_typeof(state) = 'object')
);
alter table public.tracker_progress enable row level security;
-- No direct client writes: they would bypass optimistic concurrency.
revoke all on public.tracker_progress from public, anon, authenticated;
grant select on public.tracker_progress to authenticated;
drop policy if exists "Read own progress" on public.tracker_progress;
create policy "Read own progress" on public.tracker_progress
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Create own progress" on public.tracker_progress;
drop policy if exists "Update own progress" on public.tracker_progress;

-- Definer is necessary because client roles have no table-write privilege.
-- No user_id parameter; identity comes ONLY from the verified auth JWT.
-- Empty search_path + fully-qualified objects prevent object substitution.
create or replace function public.save_tracker_progress(p_state jsonb, p_expected_version bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  new_version bigint;
begin
  if caller is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object' or pg_catalog.octet_length(p_state::text) > 1048576 then
    raise exception 'State must be a JSON object no larger than 1 MiB';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'Invalid expected version';
  end if;
  if p_expected_version = 0 then
    insert into public.tracker_progress (user_id,state,version,updated_at)
    values (caller,p_state,1,pg_catalog.now())
    on conflict (user_id) do nothing
    returning version into new_version;
  else
    update public.tracker_progress
    set state=p_state, version=version+1, updated_at=pg_catalog.now()
    where user_id=caller and version=p_expected_version
    returning version into new_version;
  end if;
  return new_version; -- NULL: stale baseline, including a missing record.
end;
$$;
revoke all on function public.save_tracker_progress(jsonb,bigint) from public, anon, authenticated;
grant execute on function public.save_tracker_progress(jsonb,bigint) to authenticated;
commit;
-- The user_id primary-key index covers ownership reads and version-checked writes.
