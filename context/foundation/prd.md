---
project: "SnapRecipe"
version: 1
status: draft
created: 2026-06-13
updated: 2026-08-16
context_type: greenfield
product_type: web-app
target_scale:
  users: large
  qps: low
  data_volume: medium
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

# SnapRecipe

## Vision & Problem Statement

Home cooks regularly save recipe content on social media — videos, reels, and screenshots from platforms like Facebook, Pinterest, and Instagram — but cannot find what they saved when it's time to cook. The content is visual and unstructured: no recipe name, no ingredient list in text form. Platform-native search fails. The only option is scrolling through saved posts hoping to stumble on the right one, which takes too long and often ends in giving up.

Existing recipe apps assume the user is browsing their catalog. None solve the "I saved this somewhere" problem for social-media content. Paid tools that come close don't match the exact workflow; this is a gap worth owning as a focused tool.

## User & Persona

**Primary persona**: A home cook — someone who regularly browses social media for recipe inspiration, saves content in the moment ("I'll make this later"), and then fails to retrieve it at meal-planning time. They are not a developer; they expect a simple save-and-find experience, not a data-entry form. The builder's wife is the design reference and first user.

### Secondary persona

The builder — operator and maintainer of the product for v1, and a secondary user of the same app.

## Success Criteria

### Primary
- A user takes a photo of a physical recipe, the app processes it and saves it to their collection without requiring manual data entry, and the user can find that recipe by searching for any of its ingredients or by filtering by type.

### Secondary
- The photo upload and save flow is operable one-handed on a phone screen without excessive scrolling or confusion.

### Guardrails
- A saved recipe must never disappear or be corrupted after a successful save confirmation.
- The photo submission step must give the user clear, visible feedback on both success and failure — a silent, status-free process is a regression.
- The UI must be in Polish at launch; an English-language UI is a launch blocker for the primary user.

## User Stories

### US-01: User saves a recipe from a photo

- **Given** a logged-in user on a mobile device
- **When** they select a photo of a physical recipe (cookbook page, handwritten card, printed sheet) from their gallery and submit it
- **Then** the app processes the photo to extract the recipe name, ingredient list, and type, saves the recipe to their personal collection, and the recipe is immediately findable by ingredient or type

#### Acceptance Criteria
- Processing produces at minimum a name and one ingredient without manual input from the user
- The recipe appears in the collection within 10 seconds of photo submission
- Each extracted ingredient is independently searchable
- After save, searching for any extracted ingredient returns this recipe
- The photo is preserved alongside the structured recipe data
- If processing fails, the user sees a clear error — the recipe is not silently discarded

### US-02: User finds a saved recipe by ingredient

- **Given** a logged-in user with at least one saved recipe containing "marchewka" in its ingredient list
- **When** they type "marchewka" in the search field
- **Then** they see a result list containing that recipe, and can tap through to view its full details

#### Acceptance Criteria
- Search matches against individual ingredients, not a full-text string
- Empty search shows the full collection ordered newest first
- Filtering by type narrows the search results further
- A zero-results search shows an explanatory empty state, not a blank screen

## Functional Requirements

### Authentication

- FR-001: User can create an account with email and password. Priority: must-have
  > Socrates: Counter-argument considered: "seed the first user manually, skip sign-up UI." Resolution: rejected — the app is for any home cook, not just one person. Sign-up is the entry point.

- FR-002: User can log in to their account. Priority: must-have
  > Socrates: No counter-argument; stands as written.

- FR-003: User can log out of their account. Priority: nice-to-have
  > Socrates: Counter-argument accepted: on mobile, users stay logged in; session expiry is sufficient. Demoted from must-have.

### Recipe Saving — Photo Flow

- FR-004: User can upload a photo of a physical recipe from their device gallery. Priority: must-have
  > Socrates: Counter-argument partially accepted: in-app camera launch is a separate UI flow from gallery upload. Gallery upload is must-have; in-app camera launch is nice-to-have.

- FR-004b: User can launch the device camera directly from within the app to photograph a recipe. Priority: nice-to-have
  > Socrates: Demoted — gallery upload covers the use case; direct camera launch is a UX enhancement.

- FR-005: After a photo is uploaded, the app extracts the recipe name, ingredient list, and type and saves the recipe to the user's collection automatically. Priority: must-have
  > Socrates: Counter-argument accepted: a pre-save review screen adds a UI state without strong benefit — FR-019 (edit) covers corrections after the fact. Changed from "view before save" to "auto-save on upload."

### Recipe Saving — Manual Flow

- FR-007: User can create a recipe manually (name, ingredients, type; no photo required). Priority: nice-to-have
  > Socrates: Counter-argument accepted: manual entry is an edge case in MVP where the photo flow is the primary story. Demoted from must-have; a photo can always be taken of a physical recipe.

### Recipe Data Fields

- FR-008: The app assigns each saved recipe a type from a predefined list (Dessert, Soup, Main course, Salad, Breakfast, Snack, Drink, Other); the user can override the assignment. Priority: must-have
  > Socrates: Counter-argument accepted: if the app assigns type automatically, a separate "user assigns type" step is redundant. Modified: app assigns, user can override.

- FR-010: User can add a freeform note to a recipe. Priority: nice-to-have
  > Socrates: Counter-argument considered: "notes are rarely read back." Resolution: kept — real use case is post-cook adjustments (portions, proportion tweaks, "kids loved this").

- FR-011: User can add per-ingredient annotations to individual ingredients within a recipe. Priority: nice-to-have
  > Socrates: Counter-argument considered: per-ingredient annotations require each ingredient to be independently addressable. Resolution: kept as nice-to-have; the data structure must support independently-addressable ingredients regardless (see FR-015 constraint).

- FR-012: User can create a custom recipe type tag beyond the predefined list. Priority: nice-to-have
  > Socrates: Counter-argument considered: "fixed list + 'Other' covers 95% of cases." Resolution: kept as nice-to-have — the fixed list covers MVP; custom tags are a v2 enrichment.

- FR-021: After a photo is uploaded, the app extracts the recipe's preparation instructions as freeform text and saves them alongside the recipe. Priority: must-have. Extraction is best-effort and non-blocking — same pattern as FR-008 (type): a failed or partial extraction does not prevent the save from succeeding.
  > Socrates: Counter-argument accepted in part: "the photo itself is already preserved as a fallback (see guardrail: photo preserved alongside structured data), so extracted instructions are a convenience layer, not the only path to the steps." Resolution: kept must-have (matches the bar of the other core recipe fields), but the counter-argument is why extraction is best-effort/nullable rather than blocking the save — same treatment as FR-008's type assignment. Added 2026-08-16 via `/10x-frame` + lightweight shaping (`context/changes/recipe-prep-instructions/`); not in the original v1 shaping — surfaced during S-01 manual testing as a core-value gap (a saved recipe couldn't be cooked from without opening the photo).

### Recipe Discovery

- FR-013: The recipe collection screen shows all saved recipes when no search query is entered. Priority: must-have
  > Socrates: Counter-argument accepted: browse and search are the same screen. "Browse all" is the empty-query state of the search view — not a separate feature.

- FR-014: User can search recipes by name. Priority: nice-to-have
  > Socrates: Counter-argument accepted: for a small MVP collection, type-filter + ingredient search is sufficient. Name search demoted; ingredient + type search are the must-have discovery paths.

- FR-015: User can search recipes by ingredient. Priority: must-have. Constraint: each ingredient must be independently addressable per recipe to support clean per-ingredient matching.
  > Socrates: Counter-argument acknowledged: matching against a full text string produces false positives ("butter" matches "buttermilk"). Resolution: accepted, with the constraint that ingredients are independently addressable — this makes per-ingredient matching possible and reduces false positives.

- FR-016: User can filter the recipe collection by type. Priority: must-have
  > Socrates: Counter-argument considered: "small collection, user can scan the full list." Resolution: rejected — filtering by meal type is the most natural browsing behavior for a recipe collection regardless of size.

- FR-017: User can sort the recipe collection by date added. Priority: nice-to-have
  > Socrates: Counter-argument considered: "default to newest-first, no sort toggle needed." Resolution: kept as nice-to-have — the default order is newest first; the sort toggle is a v1 polish item.

- FR-018: User can view a recipe's full details (name, ingredient list, type, note, photo, preparation instructions). Priority: must-have
  > Socrates: Counter-argument considered: "simplify to name + ingredients only." Resolution: rejected — the detail view is what the user reads while cooking; all captured fields must be visible.

### Recipe Management

- FR-019: User can edit a saved recipe (name, ingredients, type, note, preparation instructions). Priority: must-have
  > Socrates: Counter-argument considered: "delete and re-add is enough." Resolution: rejected — the user must be able to correct extraction results without losing the recipe and starting over.

- FR-020: User can remove a recipe from their collection; removal is reversible and the recipe remains recoverable. Priority: must-have
  > Socrates: Counter-argument considered: "immediate, permanent deletion is simpler." Resolution: user chose reversible removal — an unrecoverable permanent delete without a safety window is too risky.

## Non-Functional Requirements

- Any photo submitted for recipe processing returns a result — with at minimum a name and one ingredient — and is available in the user's collection within 10 seconds of submission.
- The app is fully operable on a mobile phone: all core flows (photo upload, ingredient search, recipe detail view) work on a phone screen without requiring a desktop-sized viewport.
- The Polish UI is complete at launch: no English-language labels, buttons, or fallback strings are visible to a Polish-speaking user in any part of the app.

## Business Logic

The app classifies each recipe by type and extracts its ingredients from a photo so the user can find any saved recipe by what's in it.

The input is a photo of a physical recipe — a cookbook page, a handwritten card, a printed sheet. The app determines the dish name, each ingredient individually, and the meal type from the image. The user does not provide this information; they only provide the photo.

The user encounters the rule at search time: they name an ingredient and the app returns every recipe that contains it, because each ingredient was extracted and made independently searchable — not buried in a block of text that would require the user to guess the exact phrasing.

## Access Control

Multi-user web app. Each authenticated user has access to their own saved recipes only; no user can access another user's collection under any circumstance.

- **Sign-up / sign-in**: email and password. Social login is a v2 feature and is not available at launch.
- **Role model**: flat — no role separation in MVP. Every authenticated user has identical permissions over their own data only.
- **Unauthenticated access**: no access to any recipe data. A public landing page may exist; everything behind it requires an authenticated session.
- **Recipe sharing**: deferred to v2. No recipe sharing between users in MVP.

## Non-Goals

- **No recipe recommendation engine**: the app saves and finds recipes; it does not suggest what to cook based on ingredients the user has available. This is the stated v2+ goal; it is explicitly out of scope until the save-and-find core is proven.
- **No social media link import**: pasting a link from a social platform to extract a recipe is a v2 feature. MVP input is a gallery photo of a physical recipe only.
- **No sharing between users**: each user's collection is fully private in MVP. A shareable view-only link per recipe is the likely v2 shape; collaborative collections are further out.
- **No offline-first guarantee**: the app requires a live network connection to process a photo. Offline capture with deferred processing is not in MVP scope.

## Open Questions

1. ~~**Recovery window for removed recipes (FR-020)**~~ — **Resolved (2026-08-16): 30 days**, matching the common trash/recycle-bin convention. No schema impact — `recipes.deleted_at` is a `timestamptz`, so the window is enforced in application logic, not a migration. See `context/foundation/roadmap.md` Open Roadmap Question 2.
