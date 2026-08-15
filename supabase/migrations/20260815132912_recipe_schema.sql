-- Recipe type enum (FR-008): predefined list, app assigns + user can override.
create type recipe_type as enum (
  'dessert',
  'soup',
  'main_course',
  'salad',
  'breakfast',
  'snack',
  'drink',
  'other'
);

-- Shared updated_at trigger function.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- recipes: one row per saved recipe, owned by the authenticated user who saved it.
create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type recipe_type not null,
  photo_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- FK index (join + cascade performance) plus a partial index for the hot path:
-- listing a user's active (non-soft-deleted) recipes.
create index recipes_user_id_idx on recipes (user_id);
create index recipes_user_id_active_idx on recipes (user_id) where deleted_at is null;

create trigger recipes_set_updated_at
  before update on recipes
  for each row
  execute function set_updated_at();

alter table recipes enable row level security;

create policy recipes_select_own on recipes
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy recipes_insert_own on recipes
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy recipes_update_own on recipes
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy recipes_delete_own on recipes
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- recipe_ingredients: independently-addressable ingredients (FR-015), one row each.
create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index recipe_ingredients_recipe_id_idx on recipe_ingredients (recipe_id);

alter table recipe_ingredients enable row level security;

-- No direct user_id column here; ownership is proven via the parent recipe.
create policy recipe_ingredients_select_own on recipe_ingredients
  for select
  to authenticated
  using (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id
        and r.user_id = (select auth.uid())
    )
  );

create policy recipe_ingredients_insert_own on recipe_ingredients
  for insert
  to authenticated
  with check (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id
        and r.user_id = (select auth.uid())
    )
  );

create policy recipe_ingredients_update_own on recipe_ingredients
  for update
  to authenticated
  using (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id
        and r.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id
        and r.user_id = (select auth.uid())
    )
  );

create policy recipe_ingredients_delete_own on recipe_ingredients
  for delete
  to authenticated
  using (
    exists (
      select 1 from recipes r
      where r.id = recipe_ingredients.recipe_id
        and r.user_id = (select auth.uid())
    )
  );
