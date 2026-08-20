-- Follow-up to 20260819161958_recipe_photo_path_storage_ownership.sql (impl review F3):
-- validate_recipe_photo_path_ownership() omitted `search_path`, unlike every other plpgsql
-- function in this migration set (edit_recipe, atomic_recipe_ingredient_edit,
-- reserve_extraction_attempt all set it). Confirmed live via Supabase's security advisor
-- (function_search_path_mutable). No behavior change — matches existing convention.
alter function validate_recipe_photo_path_ownership() set search_path = public;
