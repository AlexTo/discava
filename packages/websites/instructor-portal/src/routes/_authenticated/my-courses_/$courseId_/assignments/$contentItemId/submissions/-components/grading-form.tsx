/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { plainTextExcerpt } from '@discava/common-tiptap';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
  // What is wrong with the points, shown under the field.
  const [pointsError, setPointsError] = useState<string>();
  const [status, setStatus] = useState<string | null>(null);
  // Where focus goes once the form or the summary it is in has rendered.
  const focusNext = useRef<'summary' | 'points' | 'edit' | undefined>(
    undefined,
  );
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    const target = {
      summary: returned && !editing ? summaryRef.current : null,
      edit: returned && !editing ? editRef.current : null,
      points: editing ? pointsRef.current : null,
    }[focusNext.current ?? 'summary'];
    if (focusNext.current && target) {
      focusNext.current = undefined;
      target.focus();
    }
  });

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
      setPointsError(undefined);
      focusNext.current = 'summary';
      setStatus('Grade returned');
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
      setError(undefined);
      setPointsError(parsed.error);
      pointsRef.current?.focus();
      return;
    }
    setPointsError(undefined);
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

  let content: React.ReactNode;
  if (returned && !editing) {
    content = (
      <div className="space-y-3">
        <p ref={summaryRef} tabIndex={-1} className="text-sm">
          <span className="font-medium">
            Returned: {submission.points} / {submission.pointsOutOf}
          </span>
          {submission.gradedAt
            ? ` (updated ${new Date(submission.gradedAt).toLocaleString()})`
            : ''}
        </p>
        <Button
          ref={editRef}
          type="button"
          variant="outline"
          onClick={() => {
            focusNext.current = 'points';
            // Points were emptied after the last send; start from the grade.
            setPoints(
              submission.points !== undefined ? String(submission.points) : '',
            );
            setEditing(true);
          }}
        >
          Edit grade
        </Button>
      </div>
    );
  } else {
    content = (
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
              ref={pointsRef}
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              className="w-28"
              value={points}
              onChange={(event) => {
                setPoints(event.target.value);
                setPointsError(undefined);
              }}
              aria-invalid={Boolean(pointsError)}
              aria-describedby={
                pointsError ? 'grading-points-error' : undefined
              }
            />
            <span className="text-sm text-muted-foreground">
              out of {maxPoints}
            </span>
          </div>
          {pointsError ? (
            <p id="grading-points-error" className="text-sm text-destructive">
              {pointsError}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label id="grading-feedback-label">Feedback</Label>
          <RichTextEditor
            key={editorKey}
            value={feedback}
            onChange={setFeedback}
            ariaLabel="Feedback"
            labelledBy="grading-feedback-label"
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <PendingButton
            type="submit"
            pending={returnWork.isPending || amend.isPending}
            pendingLabel={returned ? 'Saving…' : 'Returning…'}
            disabled={requestResubmission.isPending}
          >
            {returned ? 'Save grade' : 'Return'}
          </PendingButton>
          {submission.state === 'submitted' ? (
            <PendingButton
              type="button"
              variant="outline"
              pending={requestResubmission.isPending}
              pendingLabel="Requesting…"
              disabled={
                returnWork.isPending || amend.isPending || !hasText(feedback)
              }
              onClick={onRequestResubmission}
            >
              Request resubmission
            </PendingButton>
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
                setPointsError(undefined);
                focusNext.current = 'edit';
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    );
  }

  return (
    <>
      <StatusMessage message={status} />
      {content}
    </>
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
