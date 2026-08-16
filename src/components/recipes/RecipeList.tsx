import React, { useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RECIPE_TYPE_LABELS, type RecipeTypeValue } from "@/components/recipes/recipe-type-labels";

const GENERIC_ERROR_MESSAGE = "Nie udało się usunąć przepisu. Spróbuj ponownie.";

interface RecipeListItem {
  id: string;
  name: string;
  type: RecipeTypeValue;
}

interface RecipeListProps {
  recipes: RecipeListItem[];
}

export default function RecipeList({ recipes: initialRecipes }: RecipeListProps) {
  const [recipes, setRecipes] = useState<RecipeListItem[]>(initialRecipes);
  const [confirmTarget, setConfirmTarget] = useState<RecipeListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleConfirmDelete() {
    if (!confirmTarget) return;
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/recipes/${confirmTarget.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? GENERIC_ERROR_MESSAGE);
        setIsDeleting(false);
        return;
      }
      setRecipes((prev) => prev.filter((r) => r.id !== confirmTarget.id));
      setConfirmTarget(null);
    } catch {
      setErrorMessage(GENERIC_ERROR_MESSAGE);
    } finally {
      setIsDeleting(false);
    }
  }

  if (recipes.length === 0) {
    return <p className="text-sm text-blue-100/70">Nie masz jeszcze żadnych przepisów.</p>;
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
            <a href={`/recipes/${recipe.id}`} className="min-w-0 flex-1">
              <p className="truncate font-medium text-white">{recipe.name}</p>
              <p className="text-sm text-blue-100/70">{RECIPE_TYPE_LABELS[recipe.type]}</p>
            </a>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Usuń przepis"
              onClick={() => {
                setConfirmTarget(recipe);
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>

      <Dialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usunąć przepis?</DialogTitle>
            <DialogDescription>
              {confirmTarget && `"${confirmTarget.name}" zostanie przeniesiony do kosza. Będziesz mógł go przywrócić.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setConfirmTarget(null);
              }}
              disabled={isDeleting}
            >
              Anuluj
            </Button>
            <Button
              type="button"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-500"
            >
              {isDeleting ? <Loader2 className="size-4 animate-spin" /> : "Usuń"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
