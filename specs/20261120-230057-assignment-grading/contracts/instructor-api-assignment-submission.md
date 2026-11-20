# Contract: instructor-api grading procedures

Registered in `packages/apis/instructor-api/src/router.ts`. Every procedure is a `courseInstructorProcedure`, so a caller who doesn't teach `courseId` gets `FORBIDDEN` before anything is read (FR-004). Each procedure also checks that `contentItemId` is an upload assignment (`type: 'assignment'`) in `courseId`, or returns `NOT_FOUND`. Hidden or archived content is still allowed (spec edge case).

Shared shapes:

```ts
type SubmissionState = 'not_submitted' | 'submitted' | 'resubmission_requested' | 'returned';

type FeedbackRound = {
  feedbackId: string;
  kind: 'resubmission_requested' | 'returned' | 'amended';
  feedback?: string;        // Tiptap JSON
  points?: number;
  pointsOutOf?: number;
  version: number;
  givenAt: string;
  givenBy: { userId: string; displayName: string };
};

const FeedbackSchema = z.string().max(20_000).refine(isValidTiptapDocument);
const PointsSchema = z.number().min(0).multipleOf(0.01);   // ≤ maxPoints checked against the item
```

## `assignmentSubmission.list` (query)

Input: `{ courseId, contentItemId, cursor?: string }`

Output:

```ts
{
  assignment: { title: string; maxPoints: number; dueAt?: string };
  counts: { waiting: number; resubmissionRequested: number; returned: number; notSubmitted: number };
  rows: Array<{
    userId: string;
    displayName: string;
    enrolled: boolean;                 // false = "no longer enrolled", read-only
    state: SubmissionState;
    late?: boolean;
    submittedAt?: string;              // drives "waited 3 days"
    version?: number;
    points?: number; pointsOutOf?: number;
  }>;
  nextCursor?: string;
}
```

- Order (FR-002):
  1. `submitted` rows with `enrolled`, by `submittedAt` ascending;
  2. `resubmission_requested`;
  3. `returned`;
  4. `not_submitted`;
  5. not-enrolled rows with a submission, last.
  
  Ties are broken by `userId`. Pages hold 50 rows (research R-4).
- `counts` cover the whole assignment, not the page. Not-enrolled students are excluded from `waiting`.
- Students listed are the course's enrolments (any status except `dropped`), plus `dropped` students who have a submission.

## `assignmentSubmission.get` (query)

Input: `{ courseId, contentItemId, userId }`

Output:

```ts
{
  assignment: { title: string; maxPoints: number; dueAt?: string };
  student: { userId: string; displayName: string; enrolled: boolean };
  submission: {
    state: Exclude<SubmissionState, 'not_submitted'>;
    version: number;
    reviewRevision: number;            // send back with any write
    submittedAt: string; late: boolean;
    file: { fileName: string; fileSize: number; mimeType: string; previewable: 'pdf' | 'image' | null };
    points?: number; pointsOutOf?: number; returnedAt?: string; gradedAt?: string;
  } | null;
  feedback: FeedbackRound[];           // newest first
}
```

## `assignmentSubmission.fileUrl` (mutation, `MediaUrl` function)

Input: `{ courseId, contentItemId, userId }` → `{ url: string }`. Returns the 5-minute signed download URL, or `localObjectUrl` locally. The review page fetches the PDF preview and the `<img>` source from this same URL (research R-6). `NOT_FOUND` if there is no submission.

## `assignmentSubmission.return` (mutation)

Input: `{ courseId, contentItemId, userId, version, reviewRevision, points, feedback?: string }`

- `BAD_REQUEST`: `points > maxPoints`, or `feedback` is not valid Tiptap JSON or too long.
- `PRECONDITION_FAILED`: the student is not enrolled (read-only), or the state is `returned`.
- `CONFLICT`: the version or revision is stale, or the state changed. The message says what happened ("The student submitted a newer version", "Another instructor already returned this"), and the client refetches `get`.
- Success: `{ reviewRevision }`. Writes the round (`kind: 'returned'`) and the `assignment.returned` notification in the same transaction (FR-020).

## `assignmentSubmission.requestResubmission` (mutation)

Input: `{ courseId, contentItemId, userId, version, reviewRevision, feedback: string }`

- `feedback` is required, with non-empty text (`BAD_REQUEST` otherwise).
- Allowed only from `submitted` (`PRECONDITION_FAILED` otherwise). Same `CONFLICT` and not-enrolled rules as `return`.
- Notifies with `assignment.resubmission_requested`.

## `assignmentSubmission.amendGrade` (mutation)

Input: `{ courseId, contentItemId, userId, reviewRevision, points, feedback?: string }`

- Allowed only from `returned`. Same validation, `CONFLICT` and not-enrolled rules.
- Writes a round of kind `amended` and notifies with `assignment.grade_updated`.

## `gradingQueue.list` (query), Story 5

Input: `{ limit?: number }` (default 20, max 50). The caller is the instructor; there is no `courseId`.

Output:

```ts
{
  total: number;    // waiting submissions across the caller's courses, enrolled students only
  items: Array<{
    courseId: string; courseTitle: string;
    contentItemId: string; assignmentTitle: string;
    userId: string; displayName: string;
    submittedAt: string; late: boolean;
  }>;
}
```

- Reads `courseInstructor.byInstructor` for the caller's courses, then `assignmentSubmission.byWaiting` per course. Merges them oldest first, drops `dropped` enrolments (batch get), and resolves titles and display names.
- `total` counts every enrolled waiting submission. It needs every waiting entry read (bounded by waiting work, not by course size).
