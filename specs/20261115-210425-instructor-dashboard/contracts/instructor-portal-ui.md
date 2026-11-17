# Contract: Instructor Portal UI

## Dashboard (`/dashboard`)

Replaces the placeholder page and its disclaimer. Reads `analytics.courseSummaries`.

| State | Shown |
|-------|-------|
| Loading | Skeleton cards |
| No courses | Message with a "Create a course" link to My Courses |
| Courses | One card per course: title, status badge, enrolments, active this week, completion rate (or "No data"), "Last updated" time. The whole card links to the course's analytics |
| Course with no activity | Zeros and "No data" for completion rate |
| Error | Message with a "Retry" button |

Buttons carry text only (constitution VIII).

## Course analytics (`/dashboard/$courseId`)

A new route under the dashboard. Reads `analytics.course`; the quiz panel reads `analytics.quiz` when opened.

1. **Header**: course title, "Last updated", a 30 days / 90 days choice (default 90, remembered in the URL search).
2. **Totals row**: enrolments, active, completed, dropped, completion rate, active this week.
3. **Over time**: a chart of new enrolments per day and a chart of active learners per day.
4. **Lesson drop-off**: lessons in course order, each with started, completed and completion share; a bar per lesson. Hover or focus shows the numbers. The lowest share is marked.
5. **Quizzes**: one panel per quiz. It lists questions ranked by miss rate (rank, text, attempts, misses, miss rate); questions under 5 attempts show "Not enough attempts". Beside it, the score distribution as ten bars.

Empty states: no enrolments ("No learners have enrolled yet"), no lessons, no quiz attempts. A course the user doesn't teach shows the same not-found page as an unknown course id. Charts have text alternatives (a table of the figures for assistive technology).
