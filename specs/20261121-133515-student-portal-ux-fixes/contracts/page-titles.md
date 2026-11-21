# Contract: page titles

`pageTitle(...parts)` drops parts that are empty or undefined, appends the application name ("Discava"), and joins with " · ". With no parts it is "Discava".

Each route calls `usePageTitle` with these parts. Where a part comes from a request, it is undefined until the request answers, so the title falls back to the row's "while loading or on error" column.

| Route | Loaded | While loading or on error |
|-------|--------|---------------------------|
| `/` signed out | `Browse courses · Discava` | same |
| `/` signed in | `Home · Discava` | same |
| `/search` with a query | `Search: <query> · Discava` | same (the query is in the address) |
| `/search` without one | `Search · Discava` | same |
| `/category/$slug` | `<category name> · Discava` | `Category · Discava` |
| `/instructors/$handle` | `<display name> · Discava` | `Instructor · Discava` |
| `/learn/$courseId` | `<course title> · Discava` | `Course · Discava` |
| `/learn/$courseId/start` | `<course title> · Discava` | `Course · Discava` |
| `/learn/$courseId/home` | `<course title> · Discava` | `Course · Discava` |
| `/learn/$courseId/lesson/$lessonId` | `<lesson title> · <course title> · Discava` | `Lesson · Discava`; a removed lesson: `<course title> · Discava` |
| `/my-learning` | `My Learning · Discava` | same |
| `/certificates/$certificateId` | `Certificate · Discava` | same |
| `/certificates/$certificateId/linkedin` | `Add to LinkedIn · Discava` | same |
| `/settings/notifications` | `Notification settings · Discava` | same |
| `/signin` | `Signing in · Discava` | same |
| `/unsubscribe` | `Unsubscribe · Discava` | same |

Rules:

- A title is plain text: the course's or lesson's title as stored, not shortened. The browser shortens it.
- A search query longer than 60 characters is cut to 60 with "…".
- Every route calls `usePageTitle` from its first render, with the "while loading or on error" parts until its data arrives, so a page never shows the previous page's title. Nothing else writes `document.title`: `RouteAnnouncer` does not (research R-7).
- The pages not audited by this feature (My Learning, certificates, settings, unsubscribe) get a fixed title only; nothing else on them changes.
