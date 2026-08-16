import type { Database } from "@/types";

export type RecipeTypeValue = Database["public"]["Enums"]["recipe_type"];

export const RECIPE_TYPE_LABELS: Record<RecipeTypeValue, string> = {
  dessert: "Deser",
  soup: "Zupa",
  main_course: "Danie główne",
  salad: "Sałatka",
  breakfast: "Śniadanie",
  snack: "Przekąska",
  drink: "Napój",
  other: "Inne",
};

export const RECIPE_TYPE_VALUES = [
  "dessert",
  "soup",
  "main_course",
  "salad",
  "breakfast",
  "snack",
  "drink",
  "other",
] as const satisfies readonly RecipeTypeValue[];
