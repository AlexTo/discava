# Contract: transcript search in the student portal's course player

In `packages/websites/student-portal/src/routes/learn/$courseId/`.

## The search box (`-components/transcript-search-box.tsx`)

Rendered by `CoursePlayerLayout` in its header, on the course home, every lesson and the results page, for a learner with an enrolment.

- A `<form role="search" aria-label="Search this course's transcripts">` with a labelled text input ("Search transcripts") and a "Search" submit button (text, no icon-only control).
- Submitting with 2 to 200 characters after trimming goes to `/learn/$courseId/search?q=<text>`. Shorter text does nothing and shows "Type at least 2 characters" beside the box. The input has `maxLength={200}`.
- On the results page the box shows the current `q`.
- Nothing is requested while typing.
- At 375 px the form takes the full width under the course title.

## The results route (`search.tsx`, `-components/transcript-search-results.tsx`)

`/learn/$courseId/search`, with `validateSearch` giving `{ q?: string }`, `beforeLoad: requireSignIn`, rendered inside `CoursePlayerLayout` with the crumb "Search".

Data: `trpc.transcript.search`, with `{ courseId, q, language }`, where `language` is `loadPreferences().captionLanguage`. `enabled` when `q` is 2 to 200 characters, `staleTime` 60 s, `retry: false`.

| State | Shows |
|-------|-------|
| No `q`, or under 2 characters | "Search what was said in this course's videos." |
| Loading | A spinner, and "Searching…" in the status region |
| Items | An `<h2>` "Moments matching '<q>'", then an `<ol>` of results |
| `hasMore` | Under the list: "Showing the 20 best matches. Add a word to narrow the search." |
| No items | "No moments match '<q>'. Check the spelling, or try the words in the captions' language." |
| `TIMEOUT` | `ErrorAlert`: "Search is starting up. Try again in a few seconds.", with a "Try again" button |
| `FORBIDDEN` or `NOT_FOUND` | What `CoursePlayerLayout` already shows for a course the learner can't enter |
| Any other error | `ErrorAlert` with `apiErrorMessage(error)` and "Try again" |

A visually hidden `role="status"` region announces "<n> moments found", "No moments match" or "Searching…".

## A result

One `<li>` holding one `<Link>`:

```text
Module 2: Optimisation · Lesson: Gradient descent          (module and lesson titles)
Lecture video · 12:40                                       (item title, time)
…so the idea behind **gradient descent** is that we step…   (snippet, matches in <mark>)
```

- The link goes to `/learn/$courseId/lesson/$lessonId` with search `{ item: contentItemId, t: startSeconds }`.
- Its accessible name reads in that order: lesson, video, time, text. The time is also given in words for screen readers.
- The item title is shown always (a lesson can hold several videos).
- Snippet parts are text nodes. Matches are in `<mark>` (bold, with the theme's highlight background).
- Times use the player's `formatTime` (`m:ss`, or `h:mm:ss` from an hour).

## Opening a moment (`lesson/$lessonId.tsx`, `-components/lesson-page.tsx`, `-components/content-item.tsx`)

- The lesson route gains `validateSearch`: `{ item?: string; t?: number }`, with `t` a whole number of seconds from 0, anything else dropped.
- With `item` naming a video in the lesson: once the lesson has rendered, that item is scrolled into view (as the step bar does) and focus moves to its player.
- The item's `VideoPlayer` passes `startAt={t}` to `HlsVideo`, and `transcript` always.
- `item` naming nothing in the lesson, or a non-video item: the params are ignored and the lesson opens as usual.
- A lesson that is no longer listed shows today's "This lesson has been removed by your instructor".

## Tests

Component tests with `renderWithCoreApi`:

- the box submits to `/learn/<courseId>/search?q=…`, refuses 1 character, and makes no request while typing;
- results render 3 moments with titles, times and marked text, and each link's `href` carries `item` and `t`;
- `hasMore` shows the narrowing hint;
- the empty state, the `TIMEOUT` state with "Try again" (which refetches), and another error;
- the request carries the saved `captionLanguage`;
- the status region's text for 3, for 0 and while loading;
- the lesson route with `?item=…&t=760` passes `startAt` 760 to that item's player only, and ignores an unknown `item`.

E2E (`packages/e2e/src/scenarios/transcript.e2e.ts`): see [quickstart.md](../quickstart.md).
