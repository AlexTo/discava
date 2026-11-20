# Contract: instructor portal UI

All buttons are text only (no arrow icons).

## The prompt form (`course-first-lesson-prompt-form.tsx`)

On the course's page, in the settings beside the certificates switch and the price form.

| Element | Detail |
|---------|--------|
| Heading | "First-lesson prompt" |
| Help | "New learners see this in the first lesson's Questions, once. Ask about the course's content, not about themselves." |
| Field | A textarea labelled "Prompt", at most 200 characters, with the count. It shows the course's own text, or is empty with the default as its placeholder |
| State line | "Using the default prompt." when the course has no text of its own |
| **Save prompt** | Calls `course.setFirstLessonPrompt` with the trimmed text, or null when blank. Disabled while unchanged or saving |
| **Use default** | Shown only when the course has its own text. Clears the field and saves null |

A failing call shows the API's message and restores the previous text. The form is available for draft, published and archived courses.

## Activation (`activation-card.tsx`)

On the course analytics page, beside the lesson drop-off section, reading `analytics.course`.

| Line | Value |
|------|-------|
| All time | "<activated> of <enrolments> enrolled learners have started (<activationRate>%)", or "No data" when there are no enrolments |
| Last 30 or 90 days (the page's selected range) | The same sentence from the daily series: the sum of `activated` over the sum of `enrolments`, or "No data" |
| Prompt | "<promptAnswered> answered the first-lesson prompt, <promptDismissed> dismissed it" |
| Note | "Started means completed an item or submitted a quiz attempt. Recent learners may still start, so these are figures so far." |

The range line follows the page's existing 30/90 choice.

## Questions area

No new view. Prompt answers appear in By lesson with the "Answer to the course prompt" label, never in Unanswered, and in Reported when reported.

## Tests

Component tests with `renderWithInstructorApi`: the form shows the default state and a custom text; saving sends the trimmed text; blank sends null; 201 characters cannot be typed past the limit and a `BAD_REQUEST` restores the text; **Use default** only with a custom text. The card shows "1 of 3 … (33%)", "No data" with no enrolments, the range line recomputed when the range changes, and the prompt counts. No arrow icons.

End to end, with `screenshot()`: the saved custom prompt and the Activation card after one of two learners completes an item.
