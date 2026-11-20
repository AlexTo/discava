# Contract: core-api `assignment` changes

Changes to the existing router in `packages/apis/core-api/src/procedures/assignment.ts`. Access rules for reads are unchanged: enrolled, and module, lesson and item shown.

## `assignment.mySubmission` (changed output)

```ts
{
  version: number;
  status: 'submitted' | 'resubmission_requested' | 'returned';   // widened
  submittedAt: string; late: boolean;
  file: { fileName: string; fileSize: number; mimeType: string };
  grade?: { points: number; pointsOutOf: number; returnedAt: string; gradedAt: string };  // when returned
  feedback: Array<{                       // newest first; [] when none
    kind: 'resubmission_requested' | 'returned' | 'amended';
    feedback?: string;                    // Tiptap JSON, rendered with RichTextView
    points?: number; pointsOutOf?: number;
    version: number; givenAt: string;
  }>;
} | null
```

The instructor's identity is not exposed to the student.

## `assignment.uploadUrl` and `assignment.submit` (changed rules)

- `requireOpenForSubmitting` refuses only `returned`, so `resubmission_requested` is open.
- The resubmit condition in `assignmentSubmissionWrites` becomes `version = existing.version AND status IN ('submitted', 'resubmission_requested')`, and the patch sets `status = 'submitted'` and the waiting keys.
- On the day's first submission to the assignment, `submit` adds the `submissionNotice` marker and the `assignment.submissions_received` items (research R-5). When the transaction is cancelled only by the marker's condition, the retry runs without them. Errors students see are unchanged.
