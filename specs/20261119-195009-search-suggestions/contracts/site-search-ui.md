# Contract: the student portal's search box (`SiteSearch`)

The top-bar search box, on every student portal page.

## States

| Trimmed text | Dropdown |
|--------------|----------|
| 0 to 2 characters | Closed. No request |
| 3 or more, before the 300 ms pause has passed | Unchanged: the previous list, or closed |
| 3 or more, answer loading | The previous list, or a "Searching…" row when there's none |
| 3 or more, answer with items | Up to 10 course rows, then "See all results for '<text>'" |
| 3 or more, answer with no items | "No courses match", then "See all results for '<text>'" |
| 3 or more, request failed | Closed, or the previous list. Never an error |
| Page loads on `/search?query=…` | Box shows the query. Dropdown closed until the text is edited |

## Rows

- **Course row**: thumbnail (or a neutral placeholder), and the title with the typed word prefixes in `<mark>`. Choosing it goes to `/learn/<courseId>` and closes the dropdown.
- **"See all results for '<text>'"**: goes to `/search?query=<text>`, the same as submitting.
- Text only, no arrow icons (repository convention).

## Keyboard

| Key | Effect |
|-----|--------|
| Down / Up | Moves the highlight through the rows, including "See all results", wrapping. The text in the box doesn't change |
| Enter, a row highlighted | Chooses that row |
| Enter, nothing highlighted | Submits: goes to `/search?query=<text>` (today's behavior). Cancels any pending request |
| Escape | Closes the dropdown and keeps the text |
| Tab, or focus leaving | Closes the dropdown |

## ARIA

- Input: `role="combobox"`, accessible name "Search courses", `aria-autocomplete="list"`, `aria-expanded`, `aria-controls=<listbox id>`, and `aria-activedescendant=<highlighted option id>` while a row is highlighted.
- List: `role="listbox"`, labelled "Course suggestions". Rows: `role="option"`, with `aria-selected="true"` on the highlighted one.
- A visually hidden live region (`role="status"`) announces "<n> suggestions" or "No courses match" when an answer is shown.

## Data

`trpc.course.publicSuggest`, keyed by the debounced trimmed text, with `staleTime` 60 s, `retry: false` and `placeholderData: keepPreviousData`. See [core-api-suggest.md](./core-api-suggest.md).
