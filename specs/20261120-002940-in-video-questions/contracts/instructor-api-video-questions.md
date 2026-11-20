# Contract: a video's questions (instructor-api)

## Schemas (`packages/apis/instructor-api/src/schema/quiz.ts` and `content-item.ts`)

```ts
export const MAX_VIDEO_QUESTIONS = 20;
// As core-table's VIDEO_POSITION_MAX_SECONDS.
const MAX_AT_SECONDS = 86_400;

// What the editor sends for one question.
export const VideoQuestionInputSchema = QuizQuestionSchema.extend({
  // Whole seconds from the start; null asks it when the video ends.
  atSeconds: z.number().int().min(0).max(MAX_AT_SECONDS).nullable(),
});

// What is stored and returned: the server adds the hash of what a student
// sees of this question (questionId, kind, prompt, options; not atSeconds).
export const VideoQuestionSchema = VideoQuestionInputSchema.extend({
  contentHash: z.string(),
});
```

`VideoContentItemSchema` gains three optional fields, so `course.view` and every video mutation return them:

```ts
questions: z.array(VideoQuestionSchema).optional(),
answerKey: QuizAnswerKeySchema.optional(),
quizVersion: z.number().optional(),
```

`QuizSettingsSchema.revealAnswers` gains `.default('after_each_attempt')` (research R-12).

## `contentItem.updateVideoQuestions` (mutation)

Built on `courseInstructorProcedure`, like `contentItem.updateQuiz`.

### Input

```ts
UpdateVideoQuestionsInputSchema = z
  .object({
    courseId, moduleId, lessonId, contentItemId,   // as other content item inputs
    // The version the editor loaded; 0 for a video that has never had questions.
    quizVersion: z.number().int().min(0),
    questions: z.array(VideoQuestionInputSchema).max(MAX_VIDEO_QUESTIONS),
    answerKey: QuizAnswerKeySchema,
  })
  .superRefine(refineQuizDefinition);
```

`refineQuizDefinition` is the quiz's own rule set: unique question ids, unique option ids within a question, an answer key entry for every question and none for others, exactly one correct option for single choice and at least one for multiple, every correct id one of the question's options, and the 300 KB bound. An empty `questions` with an empty `answerKey` is valid and removes every question.

### Output

The video content item (`VideoContentItemSchema`), with the new `questions` (each with its `contentHash`), `answerKey` and `quizVersion`.

### Behavior

| Case | Result |
|---|---|
| The caller teaches the course, the item is a video, nothing above it is archived, and `quizVersion` matches | Saved. `quizVersion` becomes the sent value plus 1. `questions` are stored sorted: timed ones by `atSeconds` (keeping the sent order for equal moments), then end questions in the sent order |
| The caller doesn't teach the course | `FORBIDDEN`, as `courseInstructorProcedure` gives |
| No such item | `NOT_FOUND` |
| The item isn't a video | `BAD_REQUEST`: "Content item is type '…', not 'video'" |
| The item, its lesson, its module or its course is archived | `PRECONDITION_FAILED`, with the same messages as other edits ("Restore the content item before editing it", "Restore the course first"…) |
| The stored version differs from the one sent, before or during the write | `CONFLICT`: "The questions were modified by another request; reload them and retry". Nothing is written |
| An invalid question, key or count | `BAD_REQUEST` (zod), with the issue's path |

The write is one transaction through `writeUnderActiveAncestors`: the module and lesson still exist and aren't archived, the item isn't archived, and the item is still at the sent version (`notExists(quizVersion)` when 0 was sent). Of two saves from the same version, exactly one lands.

The video's `status`, `s3Key`, captions, `visibility` and `studentActivityCount` are untouched, and no transcode is submitted. A video can be given questions in any status.

Saving never touches a `videoAnswerSheet`: recorded answers are kept as they are (spec FR-032).

## Other procedures

- `course.view` returns each video's `questions`, `answerKey` and `quizVersion` to the course's instructors, through the schema change above.
- `contentItem.updateVideo` (replace the upload) leaves the three attributes as they are.
- `contentItem.deletePermanently` is unchanged: it is refused while `studentActivityCount` is above 0, which now includes learners who answered a question (research R-5).

## Tests (`procedures/content-item-video-questions.test.ts`)

Authorisation (an instructor of another course, a non-instructor), each row of the table, the version race (two saves from one version: one `CONFLICT`), `contentHash` unchanged when only `atSeconds` or the key changes and changed when the prompt or an option changes, the stored order, the empty save, and that `course.view` returns the saved questions with their key.
