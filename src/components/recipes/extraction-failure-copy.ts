import type { ExtractionFailureReason } from "@/lib/services/recipe-extraction";

export type UploadFailureKey = ExtractionFailureReason | "rate_limited" | "network_error";

interface FailureCopy {
  title: string;
  tip: string;
}

export const EXTRACTION_FAILURE_COPY: Record<UploadFailureKey, FailureCopy> = {
  not_a_recipe: {
    title: "To nie wygląda na przepis",
    tip: "Upewnij się, że na zdjęciu widać przepis kulinarny — nazwę dania i listę składników.",
  },
  blurry_or_low_light: {
    title: "Zdjęcie jest nieczytelne",
    tip: "Zrób zdjęcie w lepszym oświetleniu i przytrzymaj telefon stabilnie, aby tekst był ostry.",
  },
  cut_off_or_partial: {
    title: "Przepis jest częściowo poza kadrem",
    tip: "Upewnij się, że cały przepis — nazwa i wszystkie składniki — mieści się w kadrze.",
  },
  handwriting_illegible: {
    title: "Nie udało się odczytać pisma odręcznego",
    tip: "Spróbuj zrobić wyraźniejsze zdjęcie odręcznego przepisu lub użyj przepisu drukowanego.",
  },
  incomplete_extraction: {
    title: "Nie udało się rozpoznać pełnego przepisu",
    tip: "Upewnij się, że na zdjęciu widoczna jest nazwa dania i przynajmniej jeden składnik.",
  },
  technical_error: {
    title: "Wystąpił błąd techniczny",
    tip: "Spróbuj ponownie za chwilę. Jeśli problem się powtarza, sprawdź swoje połączenie internetowe.",
  },
  rate_limited: {
    title: "Osiągnięto dzienny limit",
    tip: "Możesz dodać maksymalnie 10 przepisów dziennie. Spróbuj ponownie jutro.",
  },
  network_error: {
    title: "Nie udało się zapisać przepisu",
    tip: "Sprawdź połączenie internetowe i spróbuj ponownie.",
  },
};
