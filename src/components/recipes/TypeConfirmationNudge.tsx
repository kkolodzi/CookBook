import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RECIPE_TYPE_LABELS, RECIPE_TYPE_VALUES, type RecipeTypeValue } from "@/components/recipes/recipe-type-labels";

interface TypeConfirmationNudgeProps {
  recipeId: string;
  onConfirmed: (type: RecipeTypeValue) => void;
}

export default function TypeConfirmationNudge({ recipeId, onConfirmed }: TypeConfirmationNudgeProps) {
  const [pending, setPending] = useState<RecipeTypeValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(type: RecipeTypeValue) {
    setPending(type);
    setError(null);
    try {
      const response = await fetch(`/api/recipes/${recipeId}/type`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!response.ok) {
        setError("Nie udało się zapisać typu dania. Spróbuj ponownie.");
        setPending(null);
        return;
      }
      onConfirmed(type);
    } catch {
      setError("Nie udało się zapisać typu dania. Spróbuj ponownie.");
      setPending(null);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-yellow-400/30 bg-yellow-900/20 p-3">
      <p className="text-sm text-yellow-200">
        Nie udało się jednoznacznie rozpoznać typu dania — zapisano jako „Inne”. Wybierz właściwy typ:
      </p>
      <div className="flex flex-wrap gap-2">
        {RECIPE_TYPE_VALUES.map((type) => (
          <Button
            key={type}
            type="button"
            variant="secondary"
            disabled={pending !== null}
            onClick={() => handleSelect(type)}
            className={cn("h-8 rounded-full px-3 text-xs", pending === type && "opacity-60")}
          >
            {RECIPE_TYPE_LABELS[type]}
          </Button>
        ))}
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
