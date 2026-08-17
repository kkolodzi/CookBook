alter table recipes
  add column instructions text check (char_length(instructions) <= 5000);
