# Contract: core-api `freePreview` router and `course.publicView`

Three public tRPC **queries** in a new router, `freePreview`, in `packages/apis/core-api/src/procedures/free-preview.ts`. All are built on `publicCourseProcedure` and listed in `PUBLIC_OPERATIONS`, so signed-out callers reach them without the Cognito authorizer and each gets the stage's `publicThrottle` and WAF.

They are the only operations that return a course's content to a caller without a current enrolment. None reads `ctx.user`. None writes.

| Operation | Function |
|-----------|----------|
| `freePreview.lesson` | shared router |
| `freePreview.videoUrl` | `MediaUrl` (added to `CORE_API_DEDICATED_FUNCTIONS`) |
| `freePreview.fileUrl` | `MediaUrl` (added to `CORE_API_DEDICATED_FUNCTIONS`) |

## The gate: `loadOpenFreePreview`

`packages/apis/core-api/src/helpers/free-preview.ts`. Every operation calls it first.

```ts
loadOpenFreePreview(coreTable, { courseId, moduleId, lessonId })
  // gets course, module and lesson by key, in parallel
  // returns { course, module, lesson } when isOpenFreePreview({ course, module, lesson })
  // otherwise throws TRPCError({ code: 'NOT_FOUND', message: 'This preview is not available' })
```

`isOpenFreePreview` is `@discava/core-table`'s (see [data-model.md](../data-model.md), rule 2). The refusal is the same error for every reason.

## `freePreview.lesson`

### Input

```ts
FreePreviewLessonInputSchema = z.object({
  courseId: z.string(),
  moduleId: z.string(),
  lessonId: z.string(),
});
```

### Output

```ts
const base = { contentItemId: z.string(), title: z.string(), description: z.string().optional() };

FreePreviewItemSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('video'), durationSeconds: z.number().optional(), playable: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal('text'), body: z.string() }).strict(),
  z.object({ ...base, type: z.literal('file'), fileName: z.string(), fileSize: z.number(), mimeType: z.string() }).strict(),
  z.object({ ...base, type: z.literal('quiz'), questionCount: z.number().int() }).strict(),
]);

FreePreviewLessonOutputSchema = z.object({
  course: z.object({ courseId: z.string(), title: z.string() }).strict(),
  lesson: z.object({
    lessonId: z.string(),
    moduleId: z.string(),
    title: z.string(),
    description: z.string().optional(),
  }).strict(),
  items: z.array(FreePreviewItemSchema),
}).strict();
```

### Behaviour

- Items are the lesson's content items with `isShown(item)`, sorted by `order`, each built by `asPreviewItem`, which picks the fields above one by one and returns `undefined` for a type not in the union (an `assignment`), which is then left out.
- `playable` is `playableManifest(item) !== undefined`: true for a ready video, and for one being replaced whose previous version still plays.
- `questionCount` is the length of the quiz's `questions`.
- A lesson with no shown items returns `items: []`.

## `freePreview.videoUrl`

### Input

`ContentItemRefSchema` (`{ courseId, moduleId, lessonId, contentItemId }`), as `contentItem.videoUrl`.

### Output

```ts
FreePreviewVideoUrlOutputSchema = VideoUrlOutputSchema.omit({ resumeAt: true }).strict();
// { url, withCredentials, versionId, captions: [{ trackId, language, label, isDefault, url }] }
```

The schema is this operation's own. A field added to `contentItem.videoUrl`'s output later (in-video questions, #591) does not reach visitors unless it is added here on purpose.

### Behaviour

After the gate, the item is read by its full key and must exist, be shown, be a `video` and have a playable manifest. Then, as `course.previewVideoUrl` does:

- `url` is the manifest's CloudFront address;
- cookies are signed for the manifest's folder only (`getSignedCloudFrontCookies(prefixKey, { lifetimeSeconds: FREE_PREVIEW_COOKIE_LIFETIME_SECONDS })`, one hour) and pushed to `ctx.responseCookies`;
- `captions` are the played version's tracks (`tracksForPlayback`).

No `videoPosition` is read. In local dev there are no cookies and the address is S3Mock's, as for every video.

## `freePreview.fileUrl`

### Input

`ContentItemRefSchema`.

### Output

`FileUrlOutputSchema` (`{ url }`).

### Behaviour

After the gate, the item is read by its full key and must exist, be shown, be a `file` and have an `s3Key`. Returns `getSignedCloudFrontFileUrl(item.s3Key)`: one object, five minutes.

## Refusals (all three)

| Case | Result |
|------|--------|
| Course is a draft, archived or missing | `NOT_FOUND` "This preview is not available" |
| Module is hidden, archived or missing | the same |
| Lesson is hidden, archived, missing or not marked | the same |
| Lesson carries the mark but is an assignment lesson (data that breaks the invariant) | the same |
| Item (signing queries) is missing under that lesson, hidden, archived, of the other type, or a video with nothing playable | the same |
| Item exists and is shown but belongs to another lesson, preview or not | the same (it is not found under the key) |
| Over the stage's public throttle | API Gateway answers 429 before the Lambda runs |
| Caller is signed in, enrolled, or neither | No difference to any row |

On every refusal the signer is not called and no cookie is set.

## `course.publicView` (changed)

`PublicLessonSchema` gains one field:

```ts
PublicLessonSchema = LessonSchema.omit({ contentItems: true }).extend({
  // Whether anyone may open this lesson without enrolling (an open preview).
  freePreview: z.boolean(),
});
```

The procedure sets it with `isOpenFreePreview({ course, module, lesson })` for each lesson it returns (all of which are already visible lessons of a published course). `LessonSchema`, and so `course.view`'s output for enrolled students, does not change.

## Unchanged, and tested as unchanged

`course.view`, `course.myItemCompletions`, `course.myLessonProgress`, `contentItem.complete`, `contentItem.videoUrl`, `contentItem.saveVideoPosition`, `contentItem.fileUrl`, `quiz.view`, `quiz.submitAttempt`, `quiz.myAttempts`, `assignment.*`, `discussion.*` and `announcement.list` refuse a caller without a current enrolment exactly as before, when the lesson named is an open preview too.

## Tests

`procedures/free-preview.test.ts` (mock the table as `paid-access.test.ts` does, and the signer):

1. **Happy path.** An anonymous caller gets the lesson with a video, a text, a file and a quiz item in `order`; a signed-in caller gets the identical response; `videoUrl` returns the manifest address, the version's captions and cookies; `fileUrl` returns the signed link.
2. **Refusal matrix.** Every row of "Refusals" for each operation it applies to gives the same `NOT_FOUND`, with the signer never called. The cross-lesson rows use a real, shown video and file of a non-preview lesson of the same course.
3. **Nothing leaks.** A lesson whose items carry `s3Key`, `previousS3Key`, `captionTracks`, `captionTracksRev`, `answerKey`, `questions`, `settings`, `mediaConvertJobId`, `rawObjectETag`, `submissionNonce` and a hidden item: the serialised response contains none of those values and not the hidden item. An `assignment` item is left out.
4. **Scope and life.** The signer is called with exactly the version folder of the requested item and a lifetime of 3600 seconds; `FREE_PREVIEW_COOKIE_LIFETIME_SECONDS <= SIGNED_COOKIE_LIFETIME_SECONDS`.
5. **No writes.** No `create`, `put`, `patch`, `update`, `upsert`, `delete` or transaction is called on any entity by any of the three.
6. **A video being replaced** is `playable` and signs the previous version's folder.

`procedures/paid-access.test.ts` (extended): its table of enrolled procedures is run again against an open preview lesson of a priced course and refuses identically.

`procedures/course-public-view.test.ts`: `publicView` returns `freePreview: true` for a marked ordinary lesson and `false` for an unmarked one and for a marked assignment lesson. `procedures/course-view.test.ts`: `course.view`'s lessons carry no `freePreview`.

`router.test.ts`: the three operations exist, are in `PUBLIC_OPERATIONS`, and nothing else in the `freePreview` router is.

`packages/common/constructs/src/app/apis/core-api.test.ts`: `MediaUrl` serves exactly the six operations listed; the three new methods have no authorizer and carry the public throttle.
