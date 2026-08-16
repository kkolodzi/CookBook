-- The application-level daily cap check (count extraction_attempts, then insert one after
-- a ~10s extraction call) has a TOCTOU race: concurrent requests within that window all read
-- the same pre-insert count and can all pass, allowing a burst past the stated 10/day cap.
-- This table + function pair makes the cap atomic via a single upsert-increment statement,
-- decoupled from the extraction attempts log itself so the reservation happens instantly
-- (before the slow model call), not after.
create table extraction_daily_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);

-- RLS enabled with no policies: this table is only ever touched via the security-definer
-- function below, which bypasses RLS deliberately and scopes every write to auth.uid()
-- itself — direct client access (even to one's own row) is intentionally not needed.
alter table extraction_daily_counters enable row level security;

create or replace function reserve_extraction_attempt(p_cap integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into extraction_daily_counters (user_id, day, count)
  values (v_user_id, current_date, 1)
  on conflict (user_id, day)
  do update set count = extraction_daily_counters.count + 1
  returning count into v_count;

  return v_count <= p_cap;
end;
$$;

grant execute on function reserve_extraction_attempt(integer) to authenticated;
