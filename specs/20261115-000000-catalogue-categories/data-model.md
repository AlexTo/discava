# Data Model: Catalogue Categories, Tags and Richer Filters

Two new entities in the core table, five new attributes on `course`, and five new fields in the `courses` search index. No new DynamoDB index.

## category (new)

| Attribute | Notes |
|-----------|-------|
| `categoryId` | UUIDv7, sort key; stable identifier courses point to |
| `name` | 1 to 60 characters, unique ignoring case and surrounding or repeated spaces |
| `slug` | Derived from the name at creation, unique, immutable, URL-safe (`a-z`, `0-9`, `-`) |
| `status` | `active` or `archived` |
| `createdAt`, `updatedAt` | As other entities |

Primary key: pk fixed value `category`, sk `categoryId`. The whole taxonomy is one partition, listed with one query. No delete: archive only.

## categoryClaim (new)

Unique-constraint records written in the same transaction as their category.

| Attribute | Notes |
|-----------|-------|
| pk / sk | pk fixed `categoryClaim`; sk `slug#<slug>` or `name#<normalised name>` |
| `categoryId` | The category that owns the claim |

A category has exactly one slug claim and one name claim. Rename moves the name claim, unless the normalised name is unchanged (case or spacing only), in which case only `name` is patched.

## course (changed)

| New attribute | Notes |
|---------------|-------|
| `categoryId` | Optional; an existing category, active when set or changed |
| `tags` | Optional list of strings, normalised, at most 8, each 1 to 30 characters, no duplicates |
| `level` | Optional: `beginner`, `intermediate`, `advanced` |
| `language` | Optional language code from the fixed list |
| `durationHours` | Optional whole number 1 to 500 |

No change to keys or indexes. Existing courses simply lack the attributes.

## courses search document (changed)

| Field | Mapping | Source |
|-------|---------|--------|
| `categoryId` | keyword | `course.categoryId` |
| `tags` | keyword (array) | `course.tags` |
| `level` | keyword | `course.level` |
| `language` | keyword | `course.language` |
| `durationHours` | integer | `course.durationHours` |

Additive only (#270): no existing field changes. The category's name and slug are not stored; they are resolved from the `category` records when a response is built.

## Writes

| Case | Records written in one transaction |
|------|------------------------------------|
| Create category | `category` create; slug claim create (not exists); name claim create (not exists) |
| Rename category | `category` patch (name); new name claim create (not exists); old name claim delete (both skipped when the normalised name is unchanged: patch only). Slug claim untouched |
| Archive category | `category` patch (status), conditioned on `active`. Courses untouched |
| Set course catalogue fields | `course` patch, conditioned on the category existing and being active (or already the course's category) |

## Shared records this feature writes, and what covers them

See the Impact Check table in [plan.md](./plan.md). Summary: `course` gets a new existence check; `category` and `categoryClaim` get a consistency check; counters, completions, enrolments and progress are not touched.

## Access patterns

| Request | Key | Index |
|---------|-----|-------|
| List categories (admin and public) | query pk `category` | primary |
| Category by slug | get claim `slug#<slug>`, then get category | primary |
| Category by id (validate on course update) | get pk `category`, sk id | primary |
| Search with filters and facets | OpenSearch `courses` | n/a |
| Map ids to names for a response | the list query above | primary |
| Re-index: published courses | existing `byStatus` query in the re-index Lambda | `byStatus` |
| Invariant checks | scans of the whole table, in tests and tooling only | n/a |

No scans in user requests. Stream consumers: course INSERT/MODIFY already reach the search indexer, so the new attributes need no filter change; `category` and `categoryClaim` are read by neither the search nor the progress consumer.

## Invariants (core-table `helpers/invariants.ts`)

- `course-category-exists`: a course's `categoryId`, when set, names an existing category.
- `category-claims-consistent`: every category has exactly one slug claim and one name claim that point back to it; every claim points to an existing category; the claim's slug equals the category's slug and the claim's name equals its normalised name.
- `course-catalogue-shape`: tags are normalised, unique and at most 8; level is in the allowed set; duration is an integer in range.
- Each has a test that builds a violating snapshot and expects the violation. `TableSnapshot` gains `categories` and `categoryClaims`.
