-- Run in the Supabase SQL Editor. Contains no personal data or credentials.
begin;
create table if not exists public.ledger_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check(revision > 0),
  payload jsonb not null check(jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 20000000),
  updated_at timestamptz not null default now()
);
alter table public.ledger_snapshots enable row level security;
revoke all on public.ledger_snapshots from anon, authenticated;
grant select, insert, update on public.ledger_snapshots to authenticated;
drop policy if exists own_ledger_read on public.ledger_snapshots;
create policy own_ledger_read on public.ledger_snapshots for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists own_ledger_insert on public.ledger_snapshots;
create policy own_ledger_insert on public.ledger_snapshots for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists own_ledger_update on public.ledger_snapshots;
create policy own_ledger_update on public.ledger_snapshots for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Optimistic concurrency: a stale device receives zero rows instead of overwriting.
create or replace function public.save_ledger_snapshot(expected_revision bigint, new_payload jsonb)
returns table(revision bigint, updated_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Login required' using errcode = '42501'; end if;
  if expected_revision < 0 or expected_revision is null then raise exception 'Invalid revision'; end if;
  if new_payload is null or jsonb_typeof(new_payload) <> 'object'
     or new_payload->>'version' is distinct from '1'
     or jsonb_typeof(new_payload->'accounts') is distinct from 'array'
     or jsonb_typeof(new_payload->'transactions') is distinct from 'array'
     or octet_length(new_payload::text) > 20000000 then raise exception 'Invalid ledger payload'; end if;
  if expected_revision = 0 then
    return query insert into public.ledger_snapshots as s(user_id,revision,payload)
      values(auth.uid(),1,new_payload) on conflict(user_id) do nothing returning s.revision,s.updated_at;
  else
    return query update public.ledger_snapshots as s set payload=new_payload,revision=s.revision+1,updated_at=now()
      where s.user_id=auth.uid() and s.revision=expected_revision returning s.revision,s.updated_at;
  end if;
end;
$$;
revoke all on function public.save_ledger_snapshot(bigint,jsonb) from public,anon;
grant execute on function public.save_ledger_snapshot(bigint,jsonb) to authenticated;
commit;
