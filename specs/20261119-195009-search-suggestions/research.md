# Research: Search Suggestions as You Type

## R-1: How a part-typed word matches a title

**Decision**: Query the existing `title` field (`text`, `english` analyzer) with `match_bool_prefix`. Every analysed term but the last must match exactly. The last term matches as a prefix. Score it like full search (`function_score` with `ratingBoost`), tiebreak on `publishedAt` desc then `courseId`, and filter to `status: 'published'`.

**Rationale**:
- The mapping isn't touched, so index-sync has nothing to apply and no stage needs the re-index Lambda run.
- The query text goes through the same `english` analyzer as the indexed titles, so whole words stem the way full search does (FR-003): "designing" finds "Design Patterns".
- `match_bool_prefix` is a standard full-text query, supported by OpenSearch 3.x locally and listed for Serverless collections.
- Prefix expansion runs against one short field and is capped at 10 hits, so the cost stays small.

**Known limit**: the last term is stemmed before the prefix is applied. A part-typed word whose stem isn't a prefix of the indexed stem can miss until the next character is typed. Porter stemming can turn a part-typed "designi" into something other than "design", for example. Completed words and most part-typed words (such as "pyth", "javas", "mach lear") match. The unit tests pin the cases that must work. If reviewers or users find gaps, the follow-up is a `title.suggest` sub-field of type `search_as_you_type` with the `standard` analyzer, queried with `multi_match` `bool_prefix`. It's additive (putMapping) but needs one re-index per stage.

**Alternatives considered**:
- `search_as_you_type` sub-field now: better partial-word matching, but it's a mapping change plus a re-index on every stage for a v1 that may not need it.
- Edge n-gram analyzer on a new field: the same rollout cost, plus a custom analyzer to keep in sync with Serverless's supported settings.
- `match_phrase_prefix`: needs the words in order and adjacent. "data python" wouldn't find "Python for Data Analysis".
- Wildcard or `query_string`: slower, and `query_string` would expose query syntax to user text.

## R-2: A new procedure rather than reusing `course.publicSearch`

**Decision**: Add `course.publicSuggest` (`{ q }` in, `{ items: [{ courseId, title, imageKey? }] }` out) on `publicSearchProcedure`, in `procedures/search.ts`, with its request built by `helpers/suggest-query.ts`.

**Rationale**: `publicSearch` always runs five facet aggregations, reads every category from the core table, and returns full result cards. Suggestions need none of that (FR-016), and would fire far more often than full searches. A separate procedure also gets its own shorter timeout and its own input bounds (3 to 200 characters) without loosening `publicSearch`'s.

**Alternatives considered**: a `mode: 'suggest'` flag on `publicSearch`. That's one procedure with two output shapes, which is harder to type and test. Client-side filtering of a cached catalogue doesn't scale, and it would duplicate the stemming rules.

## R-3: Debounce, stale answers and reuse

**Decision**: `useDebouncedValue(value, 300)` in the student portal's `hooks/`. The dropdown's data is `useQuery(trpc.course.publicSuggest.queryOptions({ q: debounced }, { enabled: debounced.length >= 3 && open, staleTime: 60_000, placeholderData: keepPreviousData, retry: false }))`. The component renders the list only when the query's `q` equals the current trimmed text, or shows the previous list as a placeholder while loading.

**Rationale**:
- Keying by text means a late answer for "javas" lands in the "javas" cache entry and never shows while the box says "javascript" (FR-008, SC-003).
- TanStack Query passes an abort signal, which tRPC forwards, so a superseded request is cancelled when nothing observes it any more.
- `staleTime` gives reuse within a visit (FR-009).
- `retry: false`, because a failed suggestion is replaced by the next pause anyway and must not pile up requests during a cold start.
- Submitting the form, or choosing a row, clears the pending debounce timer and closes the dropdown, so no request fires for submitted text (FR-010).

**Debounce delay**: 300 ms, from the spec. It's a constant in `site-search.tsx`, not configuration.

**Alternatives considered**: `lodash.debounce` (a new dependency for a 10-line hook), and throttling instead of debouncing (it still sends mid-word requests).

## R-4: Combobox component

**Decision**: Hand-build the WAI-ARIA APG "combobox with listbox popup" pattern in `site-search.tsx` and `site-search-suggestions.tsx`:
- The input has `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, and `aria-activedescendant` for the highlighted row.
- The list has `role="listbox"`, and each row `role="option"` and `aria-selected`.
- A visually hidden `role="status"` region (`aria-live="polite"`) announces "N suggestions", or "No courses match".
- Down and Up move the highlight (wrapping), Enter chooses the highlighted row (or submits when none is highlighted), and Escape closes. Blur closes, after a click on a row has been handled (`onMouseDown` preventDefault on rows).

**Rationale**: The box already exists inside a `<form role="search">` with a styled shadcn `Input`, and Enter-to-submit has to keep working. shadcn's `Command` (cmdk) owns its own input, filters on the client by default and is built for menus, not remote suggestions. Adding it to `common-shadcn` for one consumer would mean disabling half of it (`shouldFilter={false}`) and restyling the input. The pattern is small, and its keyboard and ARIA behavior is fully specified by the APG, which the component tests follow.

**Alternatives considered**: shadcn `Command` inside a `Popover` (above). Downshift (a new dependency). A native `<datalist>` (it can't show images, highlight or a "See all results" row, and its behavior differs a lot between browsers).

## R-5: Highlighting the matched part

**Decision**: `lib/title-highlight.ts` splits a title into parts, marking each word that starts with one of the typed words (case-insensitive, Unicode-aware with `Intl.Collator` base sensitivity, so accents are ignored). The row renders marked parts in `<mark>`, styled as bold text with no background.

**Rationale**: It works on plain text, so there's no `dangerouslySetInnerHTML` and no server HTML. It needs no extra query work. If stemming matched a word that doesn't start with the typed text, that word simply isn't marked, which is an acceptable miss.

**Alternatives considered**: OpenSearch `highlight` on `title`. It returns HTML fragments the portal would have to sanitize, and costs more per request.

## R-6: Failure, cold start and limits

**Decision**: `course.publicSuggest` uses a 3 s request timeout and maps `TimeoutError` to tRPC `TIMEOUT`, the same mapping as `publicSearch`. The portal treats any error, a 429 included, as "no suggestions": the dropdown stays as it was or closes, with nothing logged to the user.

It gets an API Gateway throttle of its own, sized for typing traffic, through two new per-stage keys on `coreApi`: `publicSuggestThrottleRateLimit` and `publicSuggestThrottleBurstLimit`.

| Stage | Suggest throttle (rate / burst) | Other public operations |
|-------|---------------------------------|-------------------------|
| `discava-development` | 5 / 10 | 1 / 3 |
| `discava-production` | 100 / 200 | 20 / 40 |
| Default (stage sets neither key) | 100 / 200 | 20 / 40 |

**Why a throttle of its own**: Listing `course.publicSuggest` in `PUBLIC_OPERATIONS` makes `CoreApi` (`packages/common/constructs/src/app/apis/core-api.ts`) give it a method setting with `publicThrottle`, not the stage default. That limit is shared by every caller of the method, signed in or not, not counted per visitor: 1 request/s with a burst of 3 on `discava-development`, and 20 with a burst of 40 on `discava-production`. Suggestions are core-api's most frequent request, and FR-014 hides every 429. Under that limit, two people typing at once on development, or a few dozen on production, would make the dropdown quietly stop working, which breaks SC-001.

**Sizing**: The 300 ms debounce sends at most one request per pause. Someone typing steadily pauses about once a second, so one active typist costs about 1 request/s, and usually less.
- `discava-development` serves a handful of testers. 5/s with a burst of 10 covers about five people typing at once. With WAF off there, the throttle bounds what an anonymous flood costs, so it stays small: it adds 5 requests/s to what anonymous callers can reach, and core-api's reserved concurrency of 10 still caps how many requests run at once.
- `discava-production` gets 100/s with a burst of 200, about 100 people typing at the same moment. A request is a 10-hit query with no aggregations or core-table read, so it holds a Lambda for tens of milliseconds: about 5 of the router's 50 reserved concurrency at full rate. Raise it with real traffic, like the stage's other limits.

The limit is still shared by everyone, not per visitor. Neither stage's WAF has a per-IP rate rule, so one heavy caller can use the whole limit, as it can for the other public operations today. A per-IP rule is a stage-wide change outside this feature.

**Rationale (timeout)**:
- On a scale-to-zero stage (`discava-development`), the first request after a quiet spell wakes the collection, and the following pauses then succeed.
- A shorter timeout than `publicSearch`'s 8 s stops a cold start from holding Lambda concurrency for every pause.

**Alternatives considered**:
- Keep the shared `publicThrottle` and accept its cap. Rejected: at 1/s on development the manual checks with more than one tester are unreliable, and at 20/s on production the dropdown would fail silently well below the traffic the stage is sized for.
- Raise `publicThrottle` for every public operation instead. Rejected: it loosens the limit on `course.publicSearch`, `course.publicList` and the rest, which cost more per request and don't need it.
- A per-IP WAF rate rule. Not in scope (above), and development has WAF off.
