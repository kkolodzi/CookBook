import React, { useState } from "react";
import { RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RECIPE_TYPE_LABELS, type RecipeTypeValue } from "@/components/recipes/recipe-type-labels";

const GENERIC_ERROR_MESSAGE = "Nie udało się przywrócić przepisu. Spróbuj ponownie.";

interface TrashListItem {
  id: string;
  name: string;
  type: RecipeTypeValue;
}

interface TrashListProps {
  recipes: TrashListItem[];
}

export default function TrashList({ recipes: initialRecipes }: TrashListProps) {
  const [recipes, setRecipes] = useState<TrashListItem[]>(initialRecipes);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleRestore(id: string) {
    setRestoringId(id);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/recipes/${id}/restore`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? GENERIC_ERROR_MESSAGE);
        setRestoringId(null);
        return;
      }
      setRecipes((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setErrorMessage(GENERIC_ERROR_MESSAGE);
    } finally {
      setRestoringId(null);
    }
  }

  if (recipes.length === 0) {
    return <p className="text-sm text-blue-100/70">Kosz jest pusty.</p>;
  }

  return (
    <div className="space-y-3">
      {errorMessage && <p className="text-sm text-red-300">{errorMessage}</p>}
      <ul className="space-y-2">
        {recipes.map((recipe) => (
          <li
            key={recipe.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-4"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-white">{recipe.name}</p>
              <p className="text-sm text-blue-100/70">{RECIPE_TYPE_LABELS[recipe.type]}</p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleRestore(recipe.id)}
              disabled={restoringId === recipe.id}
              className="gap-1"
            >
              {restoringId === recipe.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <RotateCcw className="size-4" />
                  Przywróć
                </>
              )}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
