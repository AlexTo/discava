# Contract: portal screens

## Student portal

- **Catalogue home (`/`)**: category chips from `category.list` (name and count, linking to `/category/<slug>`), replacing the mock `categories` list; the course grid with the filter panel below.
- **Filter panel** (shared by home, search and landing pages): one group each for category (not on landing pages), level, language, duration, tags (top 20). Each value shows its count; selected values are checked; a "Clear filters" text button appears when any is active. Counts update with every change.
- **Address**: filters live in search params (`category`, `tags`, `levels`, `languages`, `durations`, plus `query` on `/search`). A reload or shared link restores them. Unknown values show the empty state.
- **Search (`/search`)**: the box still requires text; with filters selected and no text the page browses.
- **Category page (`/category/$slug`)**: heading with the category name, text search box scoped to the category, filter panel (no category group), results. States: loading, results, empty ("No courses match"), not found, no longer available (archived), cold-start retry as on search today.
- **Course card** shows level, language and duration from the course instead of the mock values.
- Buttons carry text labels only.

## Instructor portal

A "Catalogue details" form on the course page: category select (active categories; an archived current category is shown as "<name> (archived)" and stays selectable), tags input (adds on Enter or comma, chips with remove, shows the 8-tag limit), level select, language select, duration number input. Saving calls `course.updateCatalogue`; validation messages come from the API. Clearing a field clears it on the course.

## Admin portal

A "Categories" screen: table of categories (name, slug, status, course count), "Add category", inline rename, and "Archive" with confirmation. Visible only to admins (others are refused by the API). Errors (duplicate name) show inline.
