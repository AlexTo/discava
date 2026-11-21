/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { plainTextExcerpt } from '@discava/common-tiptap';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useInstructorApi } from '../../../../../../../../api';
import {
  clearGradingDraft,
  readGradingDraft,
  writeGradingDraft,
} from '../../../../../../../../lib/grading-draft';
import { RichTextEditor } from '../../../../../$courseId/-components/rich-text-editor';

const DRAFT_DELAY_MS = 400;

export interface GradingSubmission {
  state: 'submitted' | 'resubmission_requested' | 'returned';
  version: number;
  reviewRevision: number;
  points?: number;
  pointsOutOf?: number;
  returnedAt?: string;
  gradedAt?: string;
}

const hasText = (feedback: string | undefined) =>
  feedback !== undefined && plainTextExcerpt(feedback, 1) !== '';

// The points as the API takes them: from 0 to the maximum, to the cent.
const parsePoints = (text: string, maxPoints: number) => {
  const points = Number(text);
  if (text.trim() === '' || !Number.isFinite(points)) {
    return { error: 'Enter the points' };
  }
  if (points < 0 || points > maxPoints) {
    return { error: `Points must be between 0 and ${maxPoints}` };
  }
  if (Math.abs(points * 100 - Math.round(points * 100)) > 1e-6) {
    return { error: 'Points can have at most two decimal places' };
  }
  return { points };
};

// Returns the work with points and feedback, asks for a resubmission, or
// (once returned) amends the grade. What's typed is kept in localStorage until
// it's sent, so a reload or a conflict loses nothing.
export function GradingForm({
  courseId,
  contentItemId,
  userId,
  maxPoints,
  submission,
}: {
  courseId: string;
  contentItemId: string;
  userId: string;
  maxPoints: number;
  submission: GradingSubmission;
}) {
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const draftRef = { courseId, contentItemId, userId };
  const returned = submission.state === 'returned';
  const [initial] = useState(() => readGradingDraft(draftRef));
  const [editing, setEditing] = useState(!returned || initial !== null);
  const [points, setPoints] = useState(
    initial?.points ??
      (submission.points !== undefined ? String(submission.points) : ''),
  );
  const [feedback, setFeedback] = useState<string | undefined>(
    initial?.feedback,
  );
  const [error, setError] = useState<string>();
  // Remounts the editor, which reads its value only once, after a send.
  const [editorKey, setEditorKey] = useState(0);

  const returnWork = useMutation(
    trpc.assignmentSubmission.return.mutationOptions(),
  );
  const requestResubmission = useMutation(
    trpc.assignmentSubmission.requestResubmission.mutationOptions(),
  );
  const amend = useMutation(
    trpc.assignmentSubmission.amendGrade.mutationOptions(),
  );
  const busy =
    returnWork.isPending || requestResubmission.isPending || amend.isPending;

  useEffect(() => {
    const timer = setTimeout(() => {
      if (points === '' && !hasText(feedback)) {
        clearGradingDraft(draftRef);
      } else {
        writeGradingDraft(draftRef, { points, feedback });
      }
    }, DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [points, feedback, courseId, contentItemId, userId]);

  const refetch = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.assignmentSubmission.get.pathFilter()),
      queryClient.invalidateQueries(
        trpc.assignmentSubmission.list.pathFilter(),
      ),
    ]);

  const send = async (action: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await action();
      clearGradingDraft(draftRef);
      // Emptied too, or the draft effect would write the points straight back.
      setPoints('');
      setFeedback(undefined);
      setEditorKey((key) => key + 1);
      setEditing(false);
      await refetch();
    } catch (failure) {
      const code = (failure as { data?: { code?: string } }).data?.code;
      setError(apiErrorMessage(failure, "Couldn't save. Try again."));
      // The draft stays; a conflict means the page was out of date.
      if (code === 'CONFLICT') {
        await refetch();
      }
    }
  };

  const ref = { courseId, contentItemId, userId };
  const { version, reviewRevision } = submission;

  const onReturn = () => {
    const parsed = parsePoints(points, maxPoints);
    if (parsed.error !== undefined) {
      setError(parsed.error);
      return;
    }
    const body = hasText(feedback) ? { feedback } : {};
    void send(() =>
      returned
        ? amend.mutateAsync({
            ...ref,
            reviewRevision,
            points: parsed.points,
            ...body,
          })
        : returnWork.mutateAsync({
            ...ref,
            version,
            reviewRevision,
            points: parsed.points,
            ...body,
          }),
    );
  };

  const onRequestResubmission = () => {
    if (feedback === undefined || !hasText(feedback)) {
      return;
    }
    void send(() =>
      requestResubmission.mutateAsync({
        ...ref,
        version,
        reviewRevision,
        feedback,
      }),
    );
  };

  if (returned && !editing) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          <span className="font-medium">
            Returned: {submission.points} / {submission.pointsOutOf}
          </span>
          {submission.gradedAt
            ? ` (updated ${new Date(submission.gradedAt).toLocaleString()})`
            : ''}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditing(true)}
        >
          Edit grade
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onReturn();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="grading-points">Points</Label>
        <div className="flex items-center gap-2">
          <Input
            id="grading-points"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            className="w-28"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
          />
          <span className="text-sm text-muted-foreground">
            out of {maxPoints}
          </span>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Feedback</Label>
        <RichTextEditor
          key={editorKey}
          value={feedback}
          onChange={setFeedback}
          ariaLabel="Feedback"
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {returned ? 'Save grade' : 'Return'}
        </Button>
        {submission.state === 'submitted' ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy || !hasText(feedback)}
            onClick={onRequestResubmission}
          >
            Request resubmission
          </Button>
        ) : null}
        {returned ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              clearGradingDraft(draftRef);
              setPoints('');
              setFeedback(undefined);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

// Shown in place of the form for a student who has left the course.
export function ReadOnlyNotice() {
  return (
    <p className="text-sm text-muted-foreground">
      This student has left the course. Their work can be read but not graded.
    </p>
  );
}
