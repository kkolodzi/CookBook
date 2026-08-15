-- Extraction attempts log (S-01): one row per photo extraction call.
-- Serves two purposes: counting a user's calls for the daily rate cap, and
-- storing the raw model response for debugging/prompt-tuning.
create type extraction_failure_reason as enum (
  'not_a_recipe',
  'blurry_or_low_light',
  'cut_off_or_partial',
  'handwriting_illegible',
  'incomplete_extraction',
  'technical_error'
);

create table extraction_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  success boolean not null,
  failure_reason extraction_failure_reason,
  raw_response jsonb,
  recipe_id uuid references recipes (id) on delete set null,
  constraint extraction_attempts_reason_consistency check (
    (success and failure_reason is null) or (not success and failure_reason is not null)
  )
);

-- Supports the daily-cap count query: count(*) where user_id = $me and created_at >= today.
create index extraction_attempts_user_id_created_at_idx on extraction_attempts (user_id, created_at);

alter table extraction_attempts enable row level security;

-- Immutable log: select/insert only, no update/delete policies.
create policy extraction_attempts_select_own on extraction_attempts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy extraction_attempts_insert_own on extraction_attempts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
