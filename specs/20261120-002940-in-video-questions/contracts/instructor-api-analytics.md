# Contract: video question results (instructor-api analytics)

Both procedures are built on `analyticsCourseProcedure`, so a caller who doesn't teach the course gets `NOT_FOUND`, as for an unknown course. Aggregates only: no learner identifier appears.

## `analytics.course`: two new output fields

```ts
/** Videos currently shown to students that have questions, in course order. */
videoQuestions: z.array(
  z.object({
    contentItemId: z.string(),
    lessonId: z.string(),
    title: z.string(),
    /** How many questions the video has now. */
    questions: z.number().int().positive(),
  }),
),
/**
 * Modules currently shown to students with at least one shown video and
 * no shown quiz and no shown video with questions, in course order.
 */
modulesWithoutQuestions: z.array(
  z.object({ moduleId: z.string(), title: z.string() }),
),
```

"Shown" is the rule the lesson and quiz lists already use (`shownCurriculum` in `analytics-reads.ts`): the record and everything above it visible and not archived.

## `analytics.videoQuestions` (query)

### Input

`{ courseId, contentItemId }`, as `analytics.quiz`.

### Output

```ts
VideoQuestionsAnalyticsOutputSchema = z.object({
  /** Ranked questions first (miss rate, then answers, both descending), then the rest in asking order. */
  questions: z.array(
    QuizQuestionFiguresSchema.extend({
      /** Whole seconds, or null for an end question. */
      atSeconds: z.number().int().min(0).nullable(),
    }),
  ),
});
```

`QuizQuestionFiguresSchema` is the existing one: `questionId`, `text` (the prompt as plain text), `attempts` (recorded answers), `misses`, `missRate` (a whole percent rounded down, `null` with no answers) and `ranked` (true with 5 or more answers).

### Behavior

| Case | Result |
|---|---|
| A shown video with questions | Its current questions with their figures. A removed question isn't listed; a new one shows zeros |
| The video is hidden, archived, has no questions, isn't a video, or doesn't exist in this course | `NOT_FOUND` |
| The caller doesn't teach the course | `NOT_FOUND` |

## Reads (`packages/databases/core-table/src/helpers/analytics-reads.ts`)

- `readCourseVideoQuestions(coreTable, courseId)` and `readVideoQuestionAnalytics(coreTable, courseId, contentItemId)`, beside `readCourseQuizzes` and `readQuizAnalytics`, over the same `loadCourse`.
- `readCourseAnalytics` returns `videoQuestions` and `modulesWithoutQuestions` too.
- The per-question figures and ranking are one function shared with `readQuizAnalytics`.

## Tests

`analytics-reads.test.ts`: the listing's order and that hidden and archived videos, lessons and modules are left out; figures and ranking with fewer than, exactly and more than 5 answers; a removed question dropped; the module rule for each combination (video only, video and quiz, video with questions, no video, hidden video only, quiz hidden). `procedures/analytics.test.ts`: the new fields, and `NOT_FOUND` for each row.
