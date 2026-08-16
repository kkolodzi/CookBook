interface BrowseEmptyStateCopy {
  title: string;
  tip: string;
}

export const BROWSE_EMPTY_STATE_COPY = {
  noRecipesYet: {
    title: "Nie masz jeszcze żadnych przepisów",
    tip: "Dodaj swój pierwszy przepis, robiąc zdjęcie fizycznej kartki, książki kucharskiej lub wydruku.",
  },
  noResults: {
    title: "Nie znaleziono przepisów",
    tip: "Spróbuj innego składnika lub usuń filtr typu dania.",
  },
} as const satisfies Record<string, BrowseEmptyStateCopy>;
