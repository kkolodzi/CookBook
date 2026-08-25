-- Fixes Polish ingredient search (FR-015, roadmap S-05): plain ilike substring
-- matching fails on ordinary grammatical-case variants ("cukier" vs "cukru").
-- Adds a write-time search_key column (kept in sync by a trigger, so all three
-- existing write paths — API insert, edit_recipe() RPC, seed data — pick this
-- up automatically) plus a search RPC that normalizes the query the same way.
--
-- Normalization targets common recipe-relevant Polish declension: diacritic
-- folding, a longest-suffix-first case-ending strip, and the "mobile e" vowel
-- drop (cukier -> cukr, proszek -> proszk). It is NOT a comprehensive
-- grammatical engine (no vocative/dative, no diminutive recognition —
-- "łyżeczka"/teaspoon is intentionally not unified with "łyżka"/spoon, since
-- that's a different word, not a case of the same one).
--
-- Guard: only tokens of 3+ letters are stemmed (shorter fragments, e.g. unit
-- abbreviations like "g", are left untouched). Verified by hand against real
-- production ingredient text pulled during planning: cukier/cukru,
-- masło/masła, mąka/mąki, cytryna/cytryny/cytryn, sól/soli, sok/soku,
-- jogurt/jogurtu, proszek/proszku, łyżka/łyżki/łyżek all normalize to the
-- same stem; łyżeczka deliberately does not.

create or replace function normalize_polish_ingredient(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  v_folded text;
  v_tokens text[];
  v_token text;
  v_stem text;
  v_out text[] := array[]::text[];
  v_len int;
begin
  if p_text is null then
    return null;
  end if;

  -- Lowercase, then fold Polish diacritics to their unaccented ASCII base.
  v_folded := translate(lower(p_text), 'ąćęłńóśźż', 'acelnoszz');

  -- Tokenize on anything that isn't a-z: digits, punctuation, whitespace all
  -- become boundaries, so units/quantities/prep notes pass through untouched
  -- and only alphabetic words get stemmed.
  v_tokens := regexp_split_to_array(v_folded, '[^a-z]+');

  foreach v_token in array v_tokens loop
    if v_token = '' then
      continue;
    end if;

    v_stem := v_token;
    v_len := length(v_stem);

    if v_len >= 3 then
      -- Longest-suffix-first case-ending strip (genitive/instrumental
      -- endings that actually occur in recipe ingredient text).
      if v_stem like '%ami' or v_stem like '%iem' or v_stem like '%owi' then
        v_stem := left(v_stem, length(v_stem) - 3);
      elsif v_stem like '%om' or v_stem like '%ow' or v_stem like '%ie' then
        v_stem := left(v_stem, length(v_stem) - 2);
      elsif v_stem like '%a' or v_stem like '%e' or v_stem like '%i'
         or v_stem like '%y' or v_stem like '%u' or v_stem like '%o' then
        v_stem := left(v_stem, length(v_stem) - 1);
      end if;

      -- Mobile-e drop: "...ek" -> "...k" (proszek -> proszk).
      if v_stem like '%ek' then
        v_stem := left(v_stem, length(v_stem) - 2) || 'k';
      -- "...ier" -> "...r" (cukier -> cukr) — the preceding softening "i"
      -- carries no independent sound once the mobile "e" drops.
      elsif v_stem like '%ier' then
        v_stem := left(v_stem, length(v_stem) - 3) || 'r';
      end if;
    end if;

    v_out := array_append(v_out, v_stem);
  end loop;

  return array_to_string(v_out, ' ');
end;
$$;

alter table recipe_ingredients add column search_key text;

create or replace function set_recipe_ingredient_search_key()
returns trigger
language plpgsql
as $$
begin
  new.search_key := normalize_polish_ingredient(new.name);
  return new;
end;
$$;

create trigger recipe_ingredients_set_search_key
  before insert or update of name on recipe_ingredients
  for each row
  execute function set_recipe_ingredient_search_key();

-- Backfill existing rows (including real production data) — forward-only,
-- no down migration, consistent with every prior migration in this project.
update recipe_ingredients set search_key = normalize_polish_ingredient(name);

create or replace function search_recipes_by_ingredient(
  p_query text,
  p_type recipe_type default null
)
returns table (id uuid, name text, type recipe_type, photo_path text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_normalized_query text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  v_normalized_query := normalize_polish_ingredient(p_query);

  return query
  select r.id, r.name, r.type, r.photo_path, r.created_at
  from recipes r
  where r.user_id = v_user_id
    and r.deleted_at is null
    and (p_type is null or r.type = p_type)
    and exists (
      select 1 from recipe_ingredients ri
      where ri.recipe_id = r.id
        and ri.search_key ilike '%' || v_normalized_query || '%'
    )
  order by r.created_at desc
  limit 200;
end;
$$;

grant execute on function search_recipes_by_ingredient(text, recipe_type) to authenticated;
