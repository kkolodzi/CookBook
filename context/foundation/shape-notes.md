---
project: "SnapRecipe"
context_type: greenfield
created: 2026-06-13
updated: 2026-06-13
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "data trapped somewhere — recipes exist but locked in platforms without structured retrieval"
    - topic: "build insight"
      decision: "existing paid apps exist but don't match exact needs; builder wants a pet project with full control"
    - topic: "persona scope"
      decision: "multi-user — home cooks who save recipes from social media; wife is the archetype"
    - topic: "auth model"
      decision: "email + password AND OAuth (social login) — both options available"
    - topic: "role model"
      decision: "flat for MVP — each user owns their own recipes only; no sharing in v1"
    - topic: "sharing"
      decision: "nice-to-have deferred to v2; link-based sharing is the likely shape"
    - topic: "MVP scope decision"
      decision: "scoped down — email+password only (no OAuth), photo of physical recipe only, Polish UI + manual Polish entry, search by type+ingredient (Polish text match)"
    - topic: "v2 features explicitly deferred"
      decision: "OAuth login, auto-translation to Polish, original text preservation, cross-language search, social media screenshot input, URL import"
  frs_drafted: 18
  quality_check_status: accepted
---

## Vision & Problem Statement

Home cooks regularly save recipe content on social media — videos, reels, and screenshots from Facebook, Pinterest, and Instagram — but cannot find what they saved when it's time to cook. The content is visual and unstructured: no recipe name, no ingredient list in text form. Platform-native search fails. The only option is scrolling through saved posts hoping to stumble on the right one, which takes too long and often ends in giving up.

The insight: existing recipe apps assume you're browsing their catalog. None solve the "I saved this somewhere" problem for social-media content. Paid tools that come close don't match the exact workflow; this is a gap worth owning as a focused pet project.

## User & Persona

**Primary persona**: A home cook — someone who regularly browses social media for recipe inspiration, saves content in the moment ("I'll make this later"), and then fails to retrieve it at meal-planning time. They are not a developer; they expect a simple save-and-find experience, not a data-entry form.

The product serves anyone with this habit. The builder's wife is the first user and the design reference.

**Secondary persona**: The builder himself — as the admin/maintainer for v1, and a secondary user of the same app.

## Access Control

Multi-user web app. Each user has their own account; they see only their own saved recipes.

- Sign-up / sign-in: email + password OR OAuth (at minimum one social provider, e.g. Google).
- Role model: flat — no role separation in MVP. Every authenticated user has identical permissions over their own data only.
- Unauthenticated users: no access to any recipe data. Landing / marketing page is public; everything behind it requires login.
- Sharing: deferred to v2. Likely shape: shareable link to a single recipe (view-only, no account required for viewer). No collaborative collections in MVP.

## Success Criteria

### Primary
- A user (the builder's wife is the acceptance test) takes a photo of a physical recipe, saves it through the AI-extraction + manual-edit flow, then finds it again by searching for an ingredient or type. End-to-end, no manual workaround.

### Secondary
- The photo capture and review flow feels natural on a mobile phone — camera launch, extraction result display, and edit form are usable in one hand without excessive scrolling or confusion.

### Guardrails
- A saved recipe must never disappear or be corrupted after a successful save confirmation.
- The photo upload step must give clear visible feedback on both success and failure — silent hangs are a regression.
- The UI must be in Polish at launch; an English UI is a launch blocker for the primary user.

## MVP Scope (v1)

Input: photo of a physical recipe only (cookbook page, handwritten card, printed sheet).
Auth: email + password only.
Language: Polish UI; user manually fills in Polish name/ingredients after AI pre-fill.
Search: type + ingredient, Polish text match only.

## Non-Goals

- No recipe recommendation engine in MVP — the app saves and finds recipes; it does not suggest what to cook based on fridge contents. This is the stated v2+ goal and is explicitly out of scope until the save-and-find core is proven.
- No social media URL import in MVP — pasting an Instagram, Pinterest, or Facebook link to extract a recipe is deferred to v2. MVP input is a gallery photo of a physical recipe only.
- No sharing between users in MVP — each user's recipe collection is fully private. Link-sharing (view-only) is the likely v2 shape; collaborative collections are further out.
- No offline-first guarantee — AI extraction requires a live network connection. The app does not support offline photo capture + deferred upload in MVP.

## Deferred to v2+

- OAuth (Google / Facebook login)
- Auto-translation of extracted content to Polish
- Original source text preserved alongside Polish version
- Cross-language ingredient search (marchewka = carrot = zanahoria)
- Social media screenshot input (Instagram, Pinterest, Facebook)
- URL import / link parsing

## Quality cross-check

Ran on 2026-06-13. All elements present. Status: accepted.

- Access Control: present — flat model, email+password, no sharing in MVP
- Business Logic: present — single declarative sentence (classification + extraction rule)
- Project artifacts: present — shape-notes.md with valid frontmatter checkpoint
- Timeline-cost acknowledged: present — mvp_weeks = 3 (within 3-week limit)
- Non-Goals: present — 4 explicit entries
- Preserved behavior: n/a (greenfield)

## Product Framing

- product_type: web-app (PWA with mobile wrapper — stack selector to evaluate PWA vs React Native for gallery/camera access)
- target_scale.users: large (up to 10k; 100k+ triggers AI cost review)
- target_scale.qps: low
- target_scale.data_volume: medium (photos accumulate at scale)
- timeline_budget.mvp_weeks: 3
- timeline_budget.hard_deadline: null
- timeline_budget.after_hours_only: true

## Forward: tech-stack

- Product type: web app + PWA / mobile wrapper (React Native or similar). Stack selector should evaluate whether a PWA is sufficient or a native wrapper is needed for photo/camera access.
- Scale ambition: up to 10k users. At 100k users, AI extraction API cost per recipe becomes a load-bearing cost assumption — worth a pricing model review before that milestone.
- AI extraction: a vision API is required (e.g., OpenAI Vision, Google Vision, or similar). The stack selector should evaluate cost per extraction call vs. expected daily volume.
- Multilingual UI: Polish first; English scaffold to be added. i18n framework needed from day one.

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
  > Socrates: Counter-argument partially accepted: camera launch (take photo in-app) is a separate UI flow. Gallery upload is must-have; in-app camera launch is nice-to-have.

- FR-004b: User can launch the device camera directly from within the app to photograph a recipe. Priority: nice-to-have
  > Socrates: Demoted — gallery upload covers the use case; camera launch is a UX enhancement.

- FR-005: After a photo is uploaded, the AI extracts name, ingredients, and type and saves the recipe automatically. Priority: must-have
  > Socrates: Counter-argument accepted: pre-save review screen adds a UI state without strong benefit — FR-019 (edit) covers corrections after the fact. Changed from "view before save" to "auto-save on upload."

- FR-006: ~~DROPPED~~ Pre-save editing is redundant given FR-005 auto-save and FR-019 post-save edit.

### Recipe Saving — Manual Flow

- FR-007: User can create a recipe manually (name, ingredients, type; no photo required). Priority: nice-to-have
  > Socrates: Counter-argument accepted: manual entry is an edge case in MVP where the photo flow is the primary story. Demoted from must-have; photo is always available for physical recipes.

### Recipe Data Fields

- FR-008: AI assigns a recipe to a predefined type (Dessert, Soup, Main course, Salad, Breakfast, Snack, Drink, Other); user can override the assignment. Priority: must-have
  > Socrates: Counter-argument accepted: if AI assigns type automatically, a separate "user assigns type" action is redundant. Modified: AI assigns, user can override. Still must-have.

- FR-009: ~~DROPPED~~ Source URL removed — the recipe photo is the source reference. No URL field in MVP.

- FR-010: User can add a freeform note to a recipe. Priority: nice-to-have
  > Socrates: Counter-argument considered: "notes are rarely read back." Resolution: kept — real use case is post-cook adjustments (portion size, proportion tweaks, "kids loved this"). Stays nice-to-have.

- FR-011: User can add per-ingredient annotations. Priority: nice-to-have
  > Socrates: Counter-argument considered: "structured annotations imply structured ingredient list, constraining data model." Resolution: kept as nice-to-have; data model must be designed to support structured ingredients regardless (see FR-015 constraint).

- FR-012: User can create a custom recipe type tag beyond the predefined list. Priority: nice-to-have
  > Socrates: Counter-argument considered: "fixed list + 'Other' is enough for 95% of cases." Resolution: kept as nice-to-have — the fixed list covers MVP, custom tags are a v2 enrichment.

### Recipe Discovery

- FR-013: The recipe collection screen shows all saved recipes when no search query is entered (browse = search with empty query). Priority: must-have
  > Socrates: Counter-argument accepted: browse and search are the same screen. "Browse all" is just the empty-query state of the search view — not a separate feature.

- FR-014: User can search recipes by name. Priority: nice-to-have
  > Socrates: Counter-argument accepted: for a small MVP collection, type-filter + ingredient search is sufficient. Name search demoted; ingredient + type search are the must-have discovery paths.

- FR-015: User can search recipes by ingredient. Priority: must-have. Constraint: ingredients must be stored as a structured list per recipe, not as a single text blob, to support clean matching.
  > Socrates: Counter-argument acknowledged: substring match produces false positives ("butter" matches "buttermilk"). Resolution: accepted, with the constraint that ingredients are stored as a structured list — this makes per-ingredient matching possible and reduces false positives.

- FR-016: User can filter recipes by type. Priority: must-have
  > Socrates: Counter-argument considered: "small collection, user can scan the full list." Resolution: rejected — "show me only desserts" is the most natural browsing behavior for a recipe app regardless of collection size.

- FR-017: User can sort recipes by date added. Priority: nice-to-have
  > Socrates: Counter-argument considered: "default to newest-first, no sort toggle needed." Resolution: kept as nice-to-have — the default is newest-first; the sort toggle is a v1 polish item.

- FR-018: User can view a recipe's full details (name, structured ingredient list, type, note, photo). Priority: must-have
  > Socrates: Counter-argument considered: "simplify to name + ingredients only." Resolution: rejected — the detail screen is what the user reads while cooking; all captured fields must be visible.

### Recipe Management

- FR-019: User can edit a saved recipe (name, ingredients, type, note). Priority: must-have
  > Socrates: Counter-argument considered: "delete and re-add is enough." Resolution: rejected — "full control" means correcting AI mistakes without losing the recipe and starting over. Edit is must-have.

- FR-020: User can soft-delete a recipe (archived, recoverable). Priority: must-have
  > Socrates: Counter-argument considered: "hard delete is simpler." Resolution: user chose soft-delete — permanent deletion is too risky without a recycle bin. Recipe is archived and recoverable for a defined window.

## Business Logic

The app classifies each recipe by type and extracts its ingredients from a photo so the user can find any saved recipe by what's in it.

The input is a photo of a physical recipe — a cookbook page, a handwritten card, a printed sheet. The app processes the image to identify the dish name, its ingredients (as a structured list), and its meal type. The user does not type any of this; the app determines it.

The output is a structured recipe record stored in the user's personal collection. The user encounters the rule at search time: they type an ingredient (e.g., "marchewka") and the app returns all recipes that contain it — because the ingredients were extracted and stored as individual items, not as a text block that would require substring guessing.

## Non-Functional Requirements

- AI extraction completes and the recipe is saved to the user's collection within 10 seconds of photo upload, as measured from the moment the user confirms the upload.
- The app is fully usable on a mobile phone — all core flows (upload photo, search, view recipe) are operable on a phone screen without requiring a desktop browser or desktop-sized viewport.
- The Polish UI is complete at launch: no English-language labels, buttons, or fallback strings are visible to a Polish-speaking user in any part of the app.

## User Stories

### US-01: User saves a recipe from a photo

- **Given** a logged-in user on a mobile device
- **When** they select a photo of a physical recipe (cookbook page, handwritten card, printed sheet) from their gallery and submit it
- **Then** the app automatically extracts the recipe name, ingredient list, and type via AI, saves the recipe to their personal collection, and the recipe is immediately findable by ingredient or type

#### Acceptance Criteria
- AI extraction produces at minimum a name and one ingredient without any manual input from the user
- The recipe appears in the collection within 10 seconds of photo submission
- The extracted ingredient list is stored as individual items (not a text blob)
- After save, searching for any extracted ingredient returns this recipe
- The full photo is preserved alongside the structured data
- If extraction fails, the user sees a clear error — the recipe is not silently discarded

### US-02: User finds a saved recipe by ingredient

- **Given** a logged-in user with at least one saved recipe containing "marchewka" in its ingredient list
- **When** they type "marchewka" in the search field
- **Then** they see a result list containing that recipe, and can tap through to view its full details

#### Acceptance Criteria
- Search matches against individual ingredients, not a full-text blob
- Empty search shows the full collection (newest first)
- Filtering by type narrows the search results further
- A zero-results search shows an explanatory empty state, not a blank screen
