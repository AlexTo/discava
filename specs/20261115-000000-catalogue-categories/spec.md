# Feature Specification: Catalogue Categories, Tags and Richer Filters

**Feature Branch**: `20261115-000000-catalogue-categories`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "Catalogue categories, tags and richer filters (issue #283): course category from an admin-managed taxonomy, tags, level, language and estimated duration, set by the instructor and searchable with facets, filters and category landing pages."

**Parent issue**: #283

**Design page**: [`design/catalogue-categories`](../../docs/src/content/docs/en/design/catalogue-categories.mdx)

## Clarifications

### Session 2026-11-15

- Q: Is a course's category required? → A: No. A course may have none; it still appears in the catalogue and in search and is counted under no category value. Publishing does not require a category.
- Q: One category or several per course? → A: Zero or one. Tags cover everything else.
- Q: Is the category taxonomy flat or a tree? → A: Flat. A category has a name and a URL-friendly slug; no parent. A tree can be added later.
- Q: Who manages categories, and how? → A: Members of the `admin` group, in the admin portal: create, rename (the slug never changes) and archive. Archiving hides a category from instructor choices and navigation; courses that have it keep it, and its landing page shows "no longer available".
- Q: Are tags free text or managed? → A: Free text typed by the instructor, normalised to lower case with single spaces, 1 to 30 characters, at most 8 per course. Facets show the most used tags. No admin curation in this feature.
- Q: What are level, language and duration? → A: Level is one of beginner, intermediate, advanced. Language is picked from a fixed list. Estimated duration is a whole number of hours from 1 to 500; filters use bands (under 2 hours, 2 up to 10, over 10 up to 40, over 40).
- Q: Are the new fields required to publish? → A: No. All are optional.
- Q: How do filters combine? → A: Different facets combine with AND; selected values inside one facet combine with OR. A facet's counts apply the other filters and the text query but not its own selection, so a visitor can widen it.
- Q: What do category landing pages show? → A: The category name and its published courses, with the same filters, facets and text search as the catalogue (minus the category facet), at a stable shareable address that uses the slug.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Filter and browse the catalogue with facets (Priority: P1) 🎯 MVP

A student or signed-out visitor searches or browses the catalogue and narrows the results by category, tags, level, language and duration. Each filter shows how many courses match.

**Why this priority**: This is the point of the issue: browsing that stays usable as the catalogue grows. It carries the course fields and the search side with it.

**Independent Test**: With published courses that differ in category, tags, level, language and duration, apply one filter and then several, and check the results and every facet count against the courses.

**Acceptance Scenarios**:

1. **Given** published courses with different attributes, **When** a visitor opens the catalogue or search, **Then** facets list each category, level, language, duration band and the most used tags, each with the number of matching published courses.
2. **Given** a text search, **When** the visitor selects a level, **Then** only matching courses show and the other facets' counts update to the narrowed set.
3. **Given** two selected values in one facet, **When** results show, **Then** a course matching either appears; values in two facets show only courses matching both.
4. **Given** an active filter, **When** the visitor reads that facet's own counts, **Then** they show what each value would give if chosen instead.
5. **Given** filters with no matches, **When** results show, **Then** the visitor sees an empty state and a way to clear the filters.
6. **Given** filters applied, **When** the visitor reloads or shares the address, **Then** the same filters apply.
7. **Given** a draft, archived or hidden course, **When** anyone filters, **Then** it is never in results or counts.

---

### User Story 2 - Instructor describes the course (Priority: P1)

An instructor sets a course's category, tags, level, language and estimated duration while editing it, and can change or clear them at any time, including after publishing. A published course's listing reflects the change shortly after.

**Why this priority**: Without data on courses the filters are empty.

**Independent Test**: Set all five fields on a course, publish, and check the course appears under the matching facet values; then change them and check it moves.

**Acceptance Scenarios**:

1. **Given** an instructor of a course, **When** they pick an active category, add tags, and choose level, language and duration, **Then** the values are saved and shown back.
2. **Given** invalid input (a ninth tag, an over-long tag, a duration of 0, an unknown level, an archived or unknown category), **When** they save, **Then** it is refused with a clear message and nothing changes.
3. **Given** tags typed as " Data  Science ", **When** saved, **Then** they are stored as "data science" and duplicates collapse.
4. **Given** a published course, **When** the instructor changes its category, **Then** the catalogue and search show it under the new category within a minute, and not under the old one.
5. **Given** a person who is not an instructor of the course, **When** they try to set these fields, **Then** it is refused.

---

### User Story 3 - Admin manages the category taxonomy (Priority: P2)

An admin creates, renames and archives categories in the admin portal. Instructors choose from the active ones.

**Why this priority**: Categories need a source. A seeded starting list lets Stories 1 and 2 work first.

**Independent Test**: As an admin create a category and see it offered to instructors; rename it and see the new name on courses and facets; archive it and see it no longer offered.

**Acceptance Scenarios**:

1. **Given** an admin, **When** they create a category with a unique name, **Then** it gets a unique slug and is offered to instructors.
2. **Given** a name that duplicates an existing one (ignoring case), **When** they create it, **Then** it is refused.
3. **Given** a category used by courses, **When** an admin renames it, **Then** courses, facets and the landing page show the new name, and the slug and address do not change.
4. **Given** a category used by courses, **When** an admin archives it, **Then** it is no longer offered or listed in navigation, and courses that have it keep it.
5. **Given** a user who is not an admin, **When** they call any category management action, **Then** it is refused.
6. **Given** two admins creating the same name at once, **When** both are processed, **Then** exactly one succeeds.

---

### User Story 4 - Category landing pages (Priority: P2)

A visitor opens a category's page from a navigation list or a shared link and sees its published courses with the same filters, facets and text search.

**Why this priority**: It gives browsing a front door and shareable addresses, but facets work without it.

**Independent Test**: Open a category's address and check it lists exactly that category's published courses, with facets counted inside the category.

**Acceptance Scenarios**:

1. **Given** the catalogue home, **When** it loads, **Then** active categories are listed with their course counts and link to their pages.
2. **Given** a category page, **When** it loads, **Then** it shows the category's name, its published courses, and facets for the other fields counted within the category.
3. **Given** a slug that does not exist, or an archived category, **When** opened, **Then** a clear "not found" or "no longer available" page shows with a link back to the catalogue.
4. **Given** a category with no published courses, **When** opened, **Then** an empty state shows.

---

### User Story 5 - Existing courses become searchable by the new fields (Priority: P3)

After a deploy that adds these fields, an operator can rebuild the search index from the course records so every published course carries them, using the existing re-index function.

**Why this priority**: Needed to roll the change out, but not a user-facing flow.

**Independent Test**: Run the re-index over courses that have the new fields and check the documents hold them; run it twice and get the same documents.

**Acceptance Scenarios**:

1. **Given** published courses with the new fields and an index missing them, **When** the re-index runs, **Then** every published course's document has category, tags, level, language and duration.
2. **Given** a published course with a category, **When** the re-index runs, **Then** its document refers to the course's current category.
3. **Given** the re-index runs twice, **Then** the documents are the same.

---

### Edge Cases

- A course's category is archived after assignment: the course keeps it and stays filterable by it; it is not listed in navigation, and an instructor editing the course sees it marked as archived and can keep or replace it.
- A category is renamed: every place that shows its name shows the new one at the next load, because courses refer to the category rather than copy its name.
- Tag facets are capped at the 20 most used among current results.
- A course with no duration, category, level or language appears in no value of that facet and still appears in results unless a filter on that facet is active.
- A filter value that does not exist (a hand-edited address) shows no results with the empty state, not an error; unknown parameters are ignored.
- Search is starting up (it scales to zero): the visitor gets the same retriable message as today.
- Landing pages and facets use only published courses; counts never include draft, hidden or archived courses.
- An empty text query with filters is allowed on the catalogue and landing pages (browse); the search box keeps requiring text.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A course MUST be able to carry an optional category (one), up to 8 tags, a level (beginner, intermediate or advanced), a language and an estimated duration in whole hours (1 to 500).
- **FR-002**: Instructors of a course MUST be able to set, change and clear these fields on draft and published courses; nobody else MUST be able to.
- **FR-003**: Input MUST be validated and normalised: tags lower-cased, trimmed, de-duplicated, 1 to 30 characters; the category must be active; language from the fixed list; duration in range.
- **FR-004**: The category taxonomy MUST be a flat list; each category has a name (unique ignoring case, at most 60 characters), a unique immutable slug, and an active or archived state.
- **FR-005**: Only admins MUST be able to create, rename and archive categories; any visitor MUST be able to read active categories and their published course counts.
- **FR-006**: Archiving a category MUST NOT change the courses that use it; it MUST remove it from instructor choices and navigation and make its landing page unavailable.
- **FR-007**: A category's name MUST be kept in step wherever courses show it (course details, search results, facets): a rename takes effect everywhere without editing each course.
- **FR-008**: Published courses' search entries MUST carry the new fields (the category by identifier, not by name) so they can be filtered and counted, and MUST be updated when a course's fields change. A category rename or archive needs no search update.
- **FR-009**: Search and catalogue results MUST be filterable by category, tags, level, language and duration band, combining facets with AND and values within a facet with OR.
- **FR-010**: Each facet MUST show correct counts of published courses for each value, with the text query and all other facets' filters applied but not its own selection.
- **FR-011**: The catalogue MUST support browsing without a text query (filters only), newest published first; with a text query, ordered by relevance as today.
- **FR-012**: Each active category MUST have a landing page at a stable address built from its slug, listing its published courses with the same filters, facets and search (minus the category facet).
- **FR-013**: Filter selections MUST live in the page address so they can be reloaded and shared.
- **FR-014**: The existing re-index function MUST write the new fields for every published course using the same document-building code as live indexing, and MUST be idempotent.
- **FR-015**: Adding the fields to the search index MUST be an additive mapping change that applies to an existing index without recreating it. A change that cannot be applied in place belongs to #270 and is out of scope.
- **FR-016**: Cross-record rules MUST follow repository conventions: category name and slug uniqueness, and the rules a rename or archive keeps for courses, are written through shared helpers in `core-table` with invariant checks that a test can break.
- **FR-017**: The feature MUST work end to end in local development without an AWS account, including search facets.
- **FR-018**: Courses without the new fields MUST keep working and be found by text search.
- **FR-019**: The hard-coded placeholder categories, levels and durations in the student portal MUST be replaced by the real data.
- **FR-020**: Tag curation, a category tree, personalisation, recommendations and sorting by facet are out of scope.

### Key Entities

- **Category**: An admin-managed label with a name, an immutable slug and an active or archived state. A course points to at most one.
- **Course catalogue fields**: Optional category, tags (up to 8), level, language and estimated duration on a course.
- **Tag**: A normalised free-text label on a course; not a record of its own.
- **Facet**: For one field, the values with counts of matching published courses under the other active filters.
- **Course search entry**: The searchable form of a published course, extended with the catalogue fields and the category's identifier.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a test catalogue of mixed courses, 100% of facet counts equal a manual count, for every single filter and the combinations tested.
- **SC-002**: A visitor can narrow a catalogue of 100 courses to one course with filters in under 30 seconds.
- **SC-003**: A change to a course's category, tags, level, language or duration shows in the catalogue within one minute of saving.
- **SC-004**: 0 draft, hidden or archived courses appear in any result, facet count or landing page.
- **SC-005**: After the re-index runs, 100% of published courses that have the new fields can be found through them.
- **SC-006**: A category landing page lists 100% of its published courses and 0 from other categories.
- **SC-007**: 100% of category management actions by non-admins and course field changes by non-instructors are refused.
- **SC-008**: Search and filtered browsing return results in under 2 seconds for 95% of requests once search is awake.

## Assumptions

- Search (#53) and the re-index function (#273) exist. The fields are additive to the existing course search index, so no rebuild is needed (#270 stays a separate concern).
- Admins are the existing `admin` group (Carol locally). The admin portal exists but has no management screens, and no backend serves admins yet, so the plan adds one.
- The catalogue's current mock categories are placeholders. A short seeded starting list (the same five names) is provided for local development and the development stage by a script, not hard-coded in the portal.
- Languages come from a small fixed list (English, Spanish, French, German, Portuguese, Chinese, Japanese, Hindi, Arabic) that can be extended.
- Estimated duration is entered by the instructor, not computed from content.
- No backward compatibility is needed (Discava has not launched): records and search documents change outright, and dev data is fixed by hand.
- Portal text is English-only, as elsewhere.
- Browsing the catalogue stays available to signed-out visitors.
