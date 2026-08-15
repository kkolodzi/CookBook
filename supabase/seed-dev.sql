-- DEV-ONLY manual seed data for SnapRecipe (project ref xmyeeuyeszvpvrjszohr).
-- Run manually, once, against the linked dev project (Studio SQL editor or
-- `supabase db execute -f supabase/seed-dev.sql --linked`).
-- Do NOT run this against SnapRecipe_live.

with existing_user as (
  select '0501ce12-98e9-4b29-b48c-df74d3a7a41b'::uuid as user_id
),
inserted_recipes as (
  insert into recipes (user_id, name, type, photo_path)
  select user_id, v.name, v.type, v.photo_path
  from existing_user, (
    values
      ('Placek drożdżowy', 'dessert'::recipe_type, 'seed/placek-drozdzowy.jpg'),
      ('Zupa pomidorowa', 'soup'::recipe_type, 'seed/zupa-pomidorowa.jpg'),
      ('Naleśniki', 'breakfast'::recipe_type, 'seed/nalesniki.jpg')
  ) as v(name, type, photo_path)
  returning id, name
)
insert into recipe_ingredients (recipe_id, name, position)
select r.id, i.name, i.position
from inserted_recipes r
join (
  values
    ('Placek drożdżowy', 'mąka pszenna', 0),
    ('Placek drożdżowy', 'mleko', 1),
    ('Placek drożdżowy', 'drożdże', 2),
    ('Placek drożdżowy', 'cukier', 3),
    ('Zupa pomidorowa', 'pomidory', 0),
    ('Zupa pomidorowa', 'cebula', 1),
    ('Zupa pomidorowa', 'śmietana', 2),
    ('Naleśniki', 'mąka pszenna', 0),
    ('Naleśniki', 'jajka', 1),
    ('Naleśniki', 'mleko', 2)
) as i(recipe_name, name, position)
  on i.recipe_name = r.name;
