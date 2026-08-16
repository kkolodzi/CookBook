-- RLS policies only narrow which rows a role can see once it already has table-level
-- access; the raw SQL migrations that created these tables (recipe_schema,
-- extraction_attempts) never granted that underlying access, so every query from the
-- `authenticated` role has been failing with "permission denied for table ...".
grant select, insert, update, delete on recipes to authenticated;
grant select, insert, update, delete on recipe_ingredients to authenticated;
grant select, insert on extraction_attempts to authenticated;
