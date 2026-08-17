-- Extends edit_recipe() to also update the recipe's instructions, keeping the whole edit
-- (name/type/ingredients/instructions) a single atomic transaction. p_instructions defaults to
-- null so the signature change is additive. Adding a parameter makes this a new overload rather
-- than a true replace, so the old 4-arg signature is dropped first to avoid leaving a stale,
-- still-grantable RPC surface behind.
drop function if exists edit_recipe(uuid, text, recipe_type, text[]);

create or replace function edit_recipe(
  p_recipe_id uuid,
  p_name text,
  p_type recipe_type,
  p_ingredients text[],
  p_instructions text default null
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
  set name = p_name, type = p_type, instructions = p_instructions
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

grant execute on function edit_recipe(uuid, text, recipe_type, text[], text) to authenticated;
