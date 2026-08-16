import { ImageOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RECIPE_TYPE_LABELS } from "@/components/recipes/recipe-type-labels";
import type { RecipeSummaryDto } from "@/types";

interface RecipeCardProps {
  recipe: RecipeSummaryDto;
}

export default function RecipeCard({ recipe }: RecipeCardProps) {
  return (
    <a href={`/recipes/${recipe.id}`} className="block">
      <Card className="gap-0 overflow-hidden border-white/10 bg-white/10 py-0 text-white backdrop-blur-xl transition-colors hover:bg-white/15">
        <div className="flex aspect-video items-center justify-center bg-black/20">
          {recipe.photoUrl ? (
            <img src={recipe.photoUrl} alt={recipe.name} className="h-full w-full object-cover" />
          ) : (
            <ImageOff className="size-8 text-white/30" />
          )}
        </div>
        <CardContent className="space-y-1 px-4 py-3">
          <p className="truncate font-medium">{recipe.name}</p>
          <p className="text-sm text-blue-100/70">{RECIPE_TYPE_LABELS[recipe.type]}</p>
        </CardContent>
      </Card>
    </a>
  );
}
