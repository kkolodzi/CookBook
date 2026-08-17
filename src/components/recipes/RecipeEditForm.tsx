import React, { useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { RECIPE_TYPE_LABELS, RECIPE_TYPE_VALUES, type RecipeTypeValue } from "@/components/recipes/recipe-type-labels";

const GENERIC_ERROR_MESSAGE = "Nie udało się zapisać zmian. Spróbuj ponownie.";

interface RecipeEditFormProps {
  recipe: {
    id: string;
    name: string;
    type: RecipeTypeValue;
    ingredients: string[];
    instructions: string | null;
  };
}

type Status = "idle" | "saving" | "success" | "error";

export default function RecipeEditForm({ recipe }: RecipeEditFormProps) {
  const [name, setName] = useState(recipe.name);
  const [type, setType] = useState<RecipeTypeValue>(recipe.type);
  const [ingredients, setIngredients] = useState<string[]>(recipe.ingredients.length > 0 ? recipe.ingredients : [""]);
  const [instructions, setInstructions] = useState(recipe.instructions ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function updateIngredient(index: number, value: string) {
    setIngredients((prev) => prev.map((ingredient, i) => (i === index ? value : ingredient)));
  }

  function removeIngredient(index: number) {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  }

  function addIngredient() {
    setIngredients((prev) => [...prev, ""]);
  }

  function moveIngredient(index: number, direction: -1 | 1) {
    setIngredients((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setValidationError(null);
    setErrorMessage(null);

    const trimmedName = name.trim();
    const cleanedIngredients = ingredients.map((i) => i.trim()).filter((i) => i.length > 0);

    if (!trimmedName) {
      setValidationError("Podaj nazwę przepisu.");
      return;
    }
    if (cleanedIngredients.length === 0) {
      setValidationError("Podaj co najmniej jeden składnik.");
      return;
    }

    setStatus("saving");
    try {
      const response = await fetch(`/api/recipes/${recipe.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          type,
          ingredients: cleanedIngredients,
          instructions: instructions.trim() || null,
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setErrorMessage(body?.error ?? GENERIC_ERROR_MESSAGE);
        setStatus("error");
        return;
      }

      setIngredients(cleanedIngredients);
      setStatus("success");
      window.setTimeout(() => {
        window.location.href = "/recipes";
      }, 700);
    } catch {
      setErrorMessage(GENERIC_ERROR_MESSAGE);
      setStatus("error");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5 text-white">
      {status === "success" && (
        <p className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-900/30 px-3 py-2 text-sm text-green-300">
          <CircleCheck className="size-4 shrink-0" />
          Zmiany zapisane.
        </p>
      )}
      {status === "error" && errorMessage && (
        <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">
          <CircleAlert className="size-4 shrink-0" />
          {errorMessage}
        </p>
      )}
      {validationError && (
        <p className="flex items-center gap-2 text-sm text-red-300">
          <CircleAlert className="size-4 shrink-0" />
          {validationError}
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="name" className="text-sm text-blue-100/70">
          Nazwa
        </label>
        <Input
          id="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="type" className="text-sm text-blue-100/70">
          Typ
        </label>
        <select
          id="type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as RecipeTypeValue);
          }}
          className={cn(
            "w-full rounded-md border border-white/20 bg-white/10 px-3 py-2 text-sm text-white",
            "focus:ring-2 focus:ring-purple-400/60 focus:outline-none",
          )}
        >
          {RECIPE_TYPE_VALUES.map((value) => (
            <option key={value} value={value} className="bg-slate-900">
              {RECIPE_TYPE_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <span className="text-sm text-blue-100/70">Składniki</span>
        <ul className="space-y-2">
          {ingredients.map((ingredient, index) => (
            <li key={index} className="flex items-center gap-2">
              <Input
                value={ingredient}
                onChange={(e) => {
                  updateIngredient(index, e.target.value);
                }}
                placeholder="np. 2 szklanki mąki"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Przesuń składnik w górę"
                onClick={() => {
                  moveIngredient(index, -1);
                }}
                disabled={index === 0}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Przesuń składnik w dół"
                onClick={() => {
                  moveIngredient(index, 1);
                }}
                disabled={index === ingredients.length - 1}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Usuń składnik"
                onClick={() => {
                  removeIngredient(index);
                }}
                disabled={ingredients.length === 1}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" onClick={addIngredient} className="gap-1">
          <Plus className="size-4" />
          Dodaj składnik
        </Button>
      </div>

      <div className="space-y-1">
        <label htmlFor="instructions" className="text-sm text-blue-100/70">
          Instrukcje przygotowania
        </label>
        <Textarea
          id="instructions"
          value={instructions}
          onChange={(e) => {
            setInstructions(e.target.value);
          }}
          placeholder="np. Ugotuj warzywa, następnie zmiksuj i dopraw do smaku."
          className="min-h-32 text-white"
        />
      </div>

      <Button
        type="submit"
        disabled={status === "saving"}
        className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
      >
        {status === "saving" ? (
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Zapisywanie...
          </span>
        ) : (
          "Zapisz zmiany"
        )}
      </Button>
    </form>
  );
}
