# Contract: instructor-api course catalogue fields

## `course.updateCatalogue`

Requires the caller to be an instructor of the course (like other course procedures).

Input: `{ courseId, categoryId?, tags?, level?, language?, durationHours? }`. Replace semantics: a field left out is cleared.

| Field | Rule |
|-------|------|
| `categoryId` | An existing category that is active, or the course's current category |
| `tags` | At most 8; each trimmed, inner spaces collapsed, lower-cased, 1 to 30 characters; duplicates collapse |
| `level` | `beginner`, `intermediate` or `advanced` |
| `language` | A code from the fixed list |
| `durationHours` | Integer 1 to 500 |

Output: the course (the existing `CourseSchema`, extended with the five fields). Errors: `FORBIDDEN` (not an instructor of the course), `NOT_FOUND`, `BAD_REQUEST` (validation, unknown or archived category). Works on draft, published and archived courses; for a published course the stream indexer updates the search entry.

## `category.listActive`

For the instructor's picker: active categories `[{ id, name }]`, plus, when the course being edited has an archived category, the caller sees it through the course's own `category` field. Requires the `instructor` group like other instructor-api procedures.

## Course output

`CourseSchema` gains `categoryId?`, `tags`, `level?`, `language?`, `durationHours?`.
