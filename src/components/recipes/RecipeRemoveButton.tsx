import React, { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const GENERIC_ERROR_MESSAGE = "Nie udało się usunąć przepisu. Spróbuj ponownie.";

interface RecipeRemoveButtonProps {
  recipeId: string;
  recipeName: string;
}

export default function RecipeRemoveButton({ recipeId, recipeName }: RecipeRemoveButtonProps) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleConfirmDelete() {
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/recipes/${recipeId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorMessage(body?.error ?? GENERIC_ERROR_MESSAGE);
        setIsDeleting(false);
        return;
      }
      window.location.href = "/recipes";
    } catch {
      setErrorMessage(GENERIC_ERROR_MESSAGE);
      setIsDeleting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        aria-label="Usuń przepis"
        onClick={() => {
          setOpen(true);
        }}
        className="shrink-0"
      >
        <Trash2 className="size-4" />
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Usunąć przepis?</DialogTitle>
            <DialogDescription>
              „{recipeName}” zostanie przeniesiony do kosza. Będziesz mógł go przywrócić.
            </DialogDescription>
          </DialogHeader>
          {errorMessage && <p className="text-sm text-red-300">{errorMessage}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
              disabled={isDeleting}
            >
              Anuluj
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirmDelete()}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-500"
            >
              {isDeleting ? <Loader2 className="size-4 animate-spin" /> : "Usuń"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
