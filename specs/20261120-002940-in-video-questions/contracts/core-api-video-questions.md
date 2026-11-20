# Contract: reading and answering a video's questions (core-api)

Two new procedures under a `videoQuestion` router, both on `courseProcedure` (signed in) and on the shared router Lambda, and one new field on `contentItem.videoUrl`. Schemas go in `packages/apis/core-api/src/schema/video-question.ts`, procedures in `procedures/video-question.ts`.

Every procedure takes the video's `courseId`, `moduleId`, `lessonId` and `contentItemId` (`ContentItemRefSchema`) and applies the access rule `contentItem.videoUrl` applies today: an enrolment that isn't dropped (`requireEnrolment`: `FORBIDDEN` in a published course, `NOT_FOUND` otherwise), and a video that is shown (it, its lesson and its module visible and not archived) with a playable version, else `NOT_FOUND` "This video is not available".

## `contentItem.videoUrl`: one new output field

```ts
// How many questions the video has for this caller: 0 when it has none, and
// 0 in a course that isn't published (an archived course is read-only).
questionCount: z.number().int().min(0),
```

Nothing else about `videoUrl` changes. `PreviewVideoUrlOutputSchema` (course previews) omits the field.

## `videoQuestion.view` (query)

### Output

```ts
ViewVideoQuestionsOutputSchema = z.object({
  quizVersion: z.number(),
  // In the order they are asked. Never the answer key.
  questions: z.array(
    z.object({
      questionId: z.string(),
      kind: z.enum(['single', 'multiple']),
      prompt: z.string(),                 // Tiptap JSON
      options: z.array(z.object({ optionId: z.string(), text: z.string() })),
      atSeconds: z.number().int().min(0).nullable(),
      contentHash: z.string(),
    }),
  ),
  // The caller's recorded answers to the questions above, by questionId,
  // each with the current key for that question.
  answers: z.record(
    z.string(),
    z.object({
      optionIds: z.array(z.string()),
      correct: z.boolean(),
      answeredAt: z.string(),
      correctOptionIds: z.array(z.string()),
      explanation: z.string().optional(),  // Tiptap JSON
    }),
  ),
});
```

### Behavior

| Case | Result |
|---|---|
| The video has questions and the course is published | The questions, and the caller's answers to them |
| The video has no questions | `{ quizVersion: 0, questions: [], answers: {} }` |
| The course is archived | The same empty result: questions aren't asked where nothing can be recorded |
| The caller answered a question that was since removed | That answer isn't returned (it stays in the sheet) |
| A question's key changed after the caller answered | `correct` is the recorded result; `correctOptionIds` and `explanation` are the current ones |
| Not enrolled, dropped, or the video isn't shown | As the access rule above |

`correctOptionIds` and `explanation` appear only inside `answers`, so only for questions the caller has answered (spec FR-013).

## `videoQuestion.answer` (mutation)

### Input

```ts
AnswerVideoQuestionInputSchema = ContentItemRefSchema.extend({
  questionId: z.string().min(1),
  optionIds: z.array(z.string().min(1)).min(1).max(10),
  // The contentHash of the question as the player showed it.
  contentHash: z.string().min(1),
});
```

### Output

```ts
AnswerVideoQuestionOutputSchema = z.object({
  optionIds: z.array(z.string()),     // what is on record
  correct: z.boolean(),
  answeredAt: z.string(),
  correctOptionIds: z.array(z.string()),
  explanation: z.string().optional(),
  // False when the question was already answered and this is that record.
  recorded: z.boolean(),
});
```

### Behavior

| Case | Result |
|---|---|
| First answer to this question, everything current | Graded all-or-nothing (the chosen options exactly equal `correctOptionIds`), recorded, `recorded: true` |
| The caller already has an answer to this question | The recorded answer with the current key, `recorded: false`. Nothing is written, whatever `optionIds` and `contentHash` were sent |
| `contentHash` differs from the stored question's | `CONFLICT`: "This question was updated. Check it before answering". Nothing is written |
| `questionId` isn't one of the video's questions | `NOT_FOUND`: "This question is no longer part of the video" |
| An option that isn't the question's, a repeated option, or more than one for single choice | `BAD_REQUEST`: "Invalid answer to question …" |
| The course is archived | `PRECONDITION_FAILED`: "This course is archived, so its questions are closed" |
| Not enrolled, dropped, or the video isn't shown | As the access rule above |
| The transaction loses a race three times running | `CONFLICT` (`transactionConflict()`) |

Order of checks: access, archived course, the question exists, already answered, hash, options. "Already answered" comes before the hash so a retry after the question was edited still returns the record.

Recording is one transaction from core-table's `videoAnswerWrites` (data-model, "The answer transaction"). A canceled transaction is read again and judged again, which turns a lost race into the right answer: a second tab's answer finds the first on record, an instructor's save in between is regraded or refused by hash, a video hidden in between is `NOT_FOUND`.

An answer never creates an `itemCompletion`, never touches a `quizAttempt`, `quizSummary`, `progress` or certificate, and never changes the enrolment beyond `lastActivityAt`.

## `contentItem.complete`: unchanged contract, one more condition

For a video, the first-record decision becomes "no completion and no answer sheet", and the transaction that claims it also checks that the sheet doesn't exist (research R-5). Inputs, outputs and errors are as today.

## Tests

`procedures/video-question-view.test.ts` and `video-question-answer.test.ts`, with the fixtures pattern of `quiz.fixtures.ts`:

- every row of the three tables;
- no response to a learner carries `correctOptionIds`, `explanation` or `answerKey` for an unanswered question: `videoQuestion.view`, `contentItem.videoUrl`, `course.view` and `course.publicView` for a video with questions (SC-009);
- the transaction's items: the activity writes, the first-record check when there is no completion and no sheet, none when either exists;
- answering changes no `itemCompletion`, `progress`, `quizSummary` or certificate record (SC-003);
- `completion.test.ts` gains: a video with a sheet doesn't count the learner again, and the check on the sheet is in the transaction when the completion claims the first record.
