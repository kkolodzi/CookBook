-- The general recipe-edit PATCH replaces all ingredients on save (delete old rows, insert new
-- ones). Done as separate sequential statements from the app, a failure between the two steps
-- can leave the recipe with duplicated or zero ingredients. This function makes the whole
-- update — recipe fields + ingredient replace — a single atomic transaction.
create or replace function edit_recipe(
  p_recipe_id uuid,
  p_name text,
  p_type recipe_type,
  p_ingredients text[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_updated_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  update recipes
  set name = p_name, type = p_type
  where id = p_recipe_id
    and user_id = v_user_id
    and deleted_at is null
  returning id into v_updated_id;

  if v_updated_id is null then
    return false;
  end if;

  delete from recipe_ingredients where recipe_id = p_recipe_id;

  insert into recipe_ingredients (recipe_id, name, position)
  select p_recipe_id, ingredient, (ordinality - 1)::integer
  from unnest(p_ingredients) with ordinality as t(ingredient, ordinality);

  return true;
end;
$$;

grant execute on function edit_recipe(uuid, text, recipe_type, text[]) to authenticated;
