-- Private per-user bucket for recipe photos (FR-004/FR-018).
insert into storage.buckets (id, name, public)
values ('recipe-photos', 'recipe-photos', false)
on conflict (id) do nothing;

-- `owner` (uuid) is the verified ownership column on this project's storage.objects table —
-- type-matches auth.uid() directly, no cast needed (see plan.md Critical Implementation Details).
create policy recipe_photos_select_own on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'recipe-photos'
    and owner = (select auth.uid())
  );

create policy recipe_photos_insert_own on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'recipe-photos'
    and owner = (select auth.uid())
  );

create policy recipe_photos_update_own on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'recipe-photos'
    and owner = (select auth.uid())
  )
  with check (
    bucket_id = 'recipe-photos'
    and owner = (select auth.uid())
  );

create policy recipe_photos_delete_own on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'recipe-photos'
    and owner = (select auth.uid())
  );
