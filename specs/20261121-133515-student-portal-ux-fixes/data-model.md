# Data Model: Student Portal UX Fixes

This feature stores nothing and changes no entity, index, schema or request. The core table, the search index and every API contract are as they were.

What it does define is the state a few shared UI pieces hold in the browser. None of it is persisted.

## `ResponsivePanel`

| State | Values | Starts as | Changes when |
|-------|--------|-----------|--------------|
| `open` | `true`, `false` | `false` | the trigger is used. Has no effect at the desktop breakpoint and above, where the content always shows |

It is not kept in the address: reloading a phone-width page shows the panel closed again.

## `QuizCard`

Its existing state (phase, draft, markers, submitting, error, submitted result) is unchanged. One rule is added:

| Event | Focus moves to |
|-------|----------------|
| phase becomes `question` (start, next, back, change an answer, retake) | the "Question N of M" line |
| phase becomes `review` (review answers, or questions changed while answering) | the review's summary line |
| phase becomes `result` (a submission succeeded, or "See your last result") | the score line, inside a `role="status"` region |
| phase becomes `overview` (done, or a submission closed the quiz) | the overview's summary line |
| first render of the card | nowhere: loading a lesson must not pull focus to its quiz |

## `RouteAnnouncer`

| Event | Effect |
|-------|--------|
| first load of the app | none |
| the pathname changes | once the new page has an `h1` in the main content area, it is focused. The title is not touched: the new page's `usePageTitle` sets it |
| only the search or the hash changes | none |

## Page titles

Derived, never stored: see [contracts/page-titles.md](./contracts/page-titles.md).

## Results while reloading

`CatalogueResults` shows the previous answer (courses, count and facets) until the next one arrives, marked `aria-busy`. The first load of a page has no previous answer and shows the spinner, as today.
