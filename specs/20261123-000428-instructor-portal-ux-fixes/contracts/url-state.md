# Contract: views kept in the address

Three routes gain `validateSearch`. A parameter at its default value is left out of the address. An invalid value falls back to the default, and the address is corrected with `replace`.

## `/my-courses`

| Param | Values | Default | Written by |
|-------|--------|---------|------------|
| `status` | `all`, `published`, `draft`, `archived` | `all` | the status filter (push) |
| `q` | text, trimmed; at most 200 characters | empty | the search box (replace, debounced as the filter is today) |

The list and the counts are filtered in the browser, as today. No request changes.

## `/my-courses/$courseId/questions`

| Param | Values | Default | Written by |
|-------|--------|---------|------------|
| `tab` | `unanswered`, `reported`, `by-lesson` | `unanswered` | the tabs (push) |
| `lesson` | a lesson id of this course | none | the By lesson select (push); ignored unless `tab=by-lesson` |

A `lesson` that isn't in the course's lesson list shows the By lesson tab with no lesson chosen. The request for a lesson's questions is the one the select makes today.

## `/earnings`

| Param | Values | Default | Written by |
|-------|--------|---------|------------|
| `month` | `YYYY-MM` | the current month | Month mode (push) |
| `from`, `to` | `YYYY-MM-DD`, `from` ≤ `to` | none | Custom range mode (push), both or neither |

`month` and `from`/`to` are exclusive; if both are present, the range wins. The report's request takes the same `from` and `to` the picker computes today.
