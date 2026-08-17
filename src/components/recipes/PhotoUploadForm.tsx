import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, CircleCheck, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RECIPE_TYPE_LABELS, type RecipeTypeValue } from "@/components/recipes/recipe-type-labels";
import { EXTRACTION_FAILURE_COPY, type UploadFailureKey } from "@/components/recipes/extraction-failure-copy";
import TypeConfirmationNudge from "@/components/recipes/TypeConfirmationNudge";
import type { ExtractionFailureReason } from "@/lib/services/recipe-extraction";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png"];
const GENERIC_ERROR_MESSAGE = "Nie udało się zapisać przepisu. Spróbuj ponownie.";
const REDIRECT_DELAY_MS = 2000;

function redirectToRecipes() {
  window.setTimeout(() => {
    window.location.href = "/recipes";
  }, REDIRECT_DELAY_MS);
}

type Status = "idle" | "loading" | "success" | "error";

interface SavedRecipe {
  id: string;
  name: string;
  type: RecipeTypeValue;
  ingredients: string[];
  instructions: string | null;
  photoUrl: string | null;
}

interface SuccessData {
  recipe: SavedRecipe;
  typeUnconfirmed: boolean;
}

type ErrorInfo = { kind: "reason"; reason: UploadFailureKey } | { kind: "message"; message: string };

type ApiResponseBody =
  | { success: true; recipe: SavedRecipe; typeUnconfirmed: boolean }
  | { success: false; reason: ExtractionFailureReason }
  | { error: string };

export default function PhotoUploadForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    };
  }, [filePreviewUrl]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    if (!selected) {
      setFile(null);
      setFilePreviewUrl(null);
      return;
    }
    if (!ACCEPTED_MIME_TYPES.includes(selected.type)) {
      setFile(null);
      setFilePreviewUrl(null);
      setFileError("Wybierz zdjęcie w formacie JPEG lub PNG.");
      return;
    }
    if (selected.size > MAX_FILE_SIZE_BYTES) {
      setFile(null);
      setFilePreviewUrl(null);
      setFileError("Zdjęcie jest za duże — maksymalny rozmiar to 5MB.");
      return;
    }
    setFileError(null);
    setFile(selected);
    setFilePreviewUrl(URL.createObjectURL(selected));
  }

  async function handleSubmit() {
    if (!file) return;
    setStatus("loading");

    const formData = new FormData();
    formData.set("photo", file);

    try {
      const response = await fetch("/api/recipes", { method: "POST", body: formData });
      const body = (await response.json().catch(() => null)) as ApiResponseBody | null;

      if (!response.ok || !body) {
        if (response.status === 429) {
          setErrorInfo({ kind: "reason", reason: "rate_limited" });
        } else {
          setErrorInfo({ kind: "message", message: body && "error" in body ? body.error : GENERIC_ERROR_MESSAGE });
        }
        setStatus("error");
        return;
      }

      if ("success" in body && body.success) {
        setSuccessData({ recipe: body.recipe, typeUnconfirmed: body.typeUnconfirmed });
        setStatus("success");
        if (!body.typeUnconfirmed) {
          redirectToRecipes();
        }
        return;
      }

      if ("success" in body) {
        setErrorInfo({ kind: "reason", reason: body.reason });
        setStatus("error");
        return;
      }

      setErrorInfo({ kind: "reason", reason: "network_error" });
      setStatus("error");
    } catch {
      setErrorInfo({ kind: "reason", reason: "network_error" });
      setStatus("error");
    }
  }

  function reset() {
    setStatus("idle");
    setFile(null);
    setFilePreviewUrl(null);
    setFileError(null);
    setSuccessData(null);
    setErrorInfo(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  if (status === "success" && successData) {
    return (
      <div className="space-y-4 text-white">
        <div className="flex items-center gap-2 text-green-300">
          <CircleCheck className="size-5" />
          <p className="font-medium">Przepis zapisany!</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          {filePreviewUrl && (
            <img
              src={filePreviewUrl}
              alt={successData.recipe.name}
              className="mb-3 max-h-64 w-full rounded-lg object-contain"
            />
          )}
          <p className="text-lg font-semibold">{successData.recipe.name}</p>
          <p className="text-sm text-blue-100/70">{RECIPE_TYPE_LABELS[successData.recipe.type]}</p>
          <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-blue-100/80">
            {successData.recipe.ingredients.map((ingredient) => (
              <li key={ingredient}>{ingredient}</li>
            ))}
          </ul>
          {successData.recipe.instructions && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="text-sm font-medium text-blue-100/90">Instrukcje przygotowania</p>
              <p className="mt-1 text-sm whitespace-pre-line text-blue-100/80">{successData.recipe.instructions}</p>
            </div>
          )}
        </div>
        {successData.typeUnconfirmed && (
          <TypeConfirmationNudge
            recipeId={successData.recipe.id}
            onConfirmed={(type) => {
              setSuccessData((prev) => (prev ? { recipe: { ...prev.recipe, type }, typeUnconfirmed: false } : prev));
              redirectToRecipes();
            }}
          />
        )}
        <Button onClick={reset} variant="secondary" className="w-full">
          Dodaj kolejny przepis
        </Button>
      </div>
    );
  }

  if (status === "error" && errorInfo) {
    const { title, tip } =
      errorInfo.kind === "reason"
        ? EXTRACTION_FAILURE_COPY[errorInfo.reason]
        : { title: GENERIC_ERROR_MESSAGE, tip: errorInfo.message };
    return (
      <div className="space-y-4 text-white">
        <div className="space-y-1 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">
          <p className="flex items-center gap-2 font-medium">
            <CircleAlert className="size-4 shrink-0" />
            {title}
          </p>
          <p className="text-red-200/90">{tip}</p>
        </div>
        <Button onClick={reset} className="w-full rounded-lg bg-purple-600 hover:bg-purple-500">
          Spróbuj ponownie
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <label
        htmlFor="photo"
        className={cn(
          "flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-white/20 p-6 text-center text-white transition-colors hover:border-purple-400/60",
          status === "loading" && "pointer-events-none opacity-60",
        )}
      >
        {filePreviewUrl ? (
          <img src={filePreviewUrl} alt={file?.name} className="max-h-64 w-full rounded-lg object-contain" />
        ) : (
          <ImagePlus className="size-10 text-white/50" />
        )}
        <span className="text-sm text-blue-100/70">{file ? file.name : "Wybierz zdjęcie przepisu"}</span>
        <input
          ref={inputRef}
          id="photo"
          name="photo"
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          onChange={handleFileChange}
          disabled={status === "loading"}
        />
      </label>

      {fileError && (
        <p className="flex items-center gap-2 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {fileError}
        </p>
      )}

      <Button
        type="button"
        onClick={handleSubmit}
        disabled={!file || status === "loading"}
        className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
      >
        {status === "loading" ? (
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Analizujemy zdjęcie — to może potrwać do 10 sekund...
          </span>
        ) : (
          "Prześlij zdjęcie"
        )}
      </Button>
    </div>
  );
}
