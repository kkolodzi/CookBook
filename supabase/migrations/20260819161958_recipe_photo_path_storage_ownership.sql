-- Closes a previously-deferred gap (recipe-data-schema impl review, finding F2):
-- recipes.photo_path had no validation tying it to a storage object the acting user actually
-- owns. Enforced here at the database layer via a trigger, rather than relying solely on the
-- app route's own convention of always deriving photo_path server-side.
--
-- Not `security definer`: the check only needs to see storage.objects rows the acting user
-- already owns, and new.user_id is already constrained to equal auth.uid() by recipes' own
-- insert/update RLS policies — running as the invoking role is strictly safer here, not a
-- limitation.
create or replace function validate_recipe_photo_path_ownership()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'recipe-photos'
      and name = new.photo_path
      and owner = new.user_id
  ) then
    raise exception 'photo_path must reference a storage object in recipe-photos owned by the same user';
  end if;
  return new;
end;
$$;

create trigger recipes_photo_path_ownership_check
  before insert or update of photo_path on recipes
  for each row
  execute function validate_recipe_photo_path_ownership();
