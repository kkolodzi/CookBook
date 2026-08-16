import { useEffect, useRef, useState } from "react";
import { Search, CircleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import RecipeCard from "@/components/recipes/RecipeCard";
import { RECIPE_TYPE_LABELS, RECIPE_TYPE_VALUES, type RecipeTypeValue } from "@/components/recipes/recipe-type-labels";
import { BROWSE_EMPTY_STATE_COPY } from "@/components/recipes/browse-copy";
import { cn } from "@/lib/utils";
import type { RecipeSummaryDto } from "@/types";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

interface RecipeBrowserProps {
  initialRecipes: RecipeSummaryDto[];
}

interface ListResponseBody {
  recipes: RecipeSummaryDto[];
}

export default function RecipeBrowser({ initialRecipes }: RecipeBrowserProps) {
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<RecipeTypeValue | null>(null);
  const [recipes, setRecipes] = useState<RecipeSummaryDto[]>(initialRecipes);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const isFirstRender = useRef(true);
  const collectionIsEmpty = initialRecipes.length === 0;

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const trimmedForGate = query.trim();
    if (trimmedForGate.length > 0 && trimmedForGate.length < MIN_QUERY_LENGTH) {
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(() => {
      void (async () => {
        setStatus("loading");
        try {
          const params = new URLSearchParams();
          const trimmed = query.trim();
          if (trimmed) params.set("q", trimmed);
          if (activeType) params.set("type", activeType);

          const response = await fetch(`/api/recipes?${params.toString()}`);
          const body = (await response.json().catch(() => null)) as ListResponseBody | null;

          if (cancelled) return;
          if (!response.ok || !body) {
            setStatus("error");
            return;
          }
          setRecipes(body.recipes);
          setStatus("idle");
        } catch {
          if (!cancelled) setStatus("error");
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [query, activeType]);

  const showNoRecipesYet = collectionIsEmpty && !query.trim() && !activeType;
  const showNoResults = !showNoRecipesYet && status !== "loading" && recipes.length === 0;

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Szukaj po składniku (min. 3 znaki), np. marchewka"
          className="border-white/10 bg-white/10 pl-9 text-white placeholder:text-white/40"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={activeType === null ? "default" : "outline"}
          className={cn(activeType !== null && "border-white/20 bg-transparent text-white hover:bg-white/10")}
          onClick={() => {
            setActiveType(null);
          }}
        >
          Wszystkie
        </Button>
        {RECIPE_TYPE_VALUES.map((type) => (
          <Button
            key={type}
            type="button"
            size="sm"
            variant={activeType === type ? "default" : "outline"}
            className={cn(activeType !== type && "border-white/20 bg-transparent text-white hover:bg-white/10")}
            onClick={() => {
              setActiveType(type);
            }}
          >
            {RECIPE_TYPE_LABELS[type]}
          </Button>
        ))}
      </div>

      {status === "error" && (
        <p className="flex items-center gap-2 text-sm text-red-300">
          <CircleAlert className="size-4 shrink-0" />
          Nie udało się pobrać przepisów. Spróbuj ponownie.
        </p>
      )}

      {showNoRecipesYet && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-6 text-center text-white">
          <p className="font-medium">{BROWSE_EMPTY_STATE_COPY.noRecipesYet.title}</p>
          <p className="mt-1 text-sm text-blue-100/70">{BROWSE_EMPTY_STATE_COPY.noRecipesYet.tip}</p>
          <a
            href="/recipes/new"
            className="mt-4 inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
          >
            Dodaj przepis ze zdjęcia
          </a>
        </div>
      )}

      {showNoResults && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-6 text-center text-white">
          <p className="font-medium">{BROWSE_EMPTY_STATE_COPY.noResults.title}</p>
          <p className="mt-1 text-sm text-blue-100/70">{BROWSE_EMPTY_STATE_COPY.noResults.tip}</p>
        </div>
      )}

      {!showNoRecipesYet && !showNoResults && recipes.length > 0 && (
        <div
          className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", status === "loading" && "opacity-60")}
        >
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </div>
      )}
    </div>
  );
}
