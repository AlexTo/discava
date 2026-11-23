/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';

/**
 * What a student needs besides completing the course to get a certificate:
 * passing every quiz that has a pass mark, and having every graded assignment
 * returned with at least a set percentage of its points. It shows the saved
 * values; a failed save puts the checkbox back.
 */
export function CourseCertificateCriteria({
  courseId,
  certificatesEnabled,
  requireQuizPass,
  minUploadScorePercent,
}: {
  courseId: string;
  certificatesEnabled: boolean;
  requireQuizPass: boolean;
  minUploadScorePercent?: number;
}) {
  const { course } = useInstructorApi();
  const queryClient = useQueryClient();
  // What the checkbox shows while a save is in flight; the saved value
  // otherwise.
  const [pending, setPending] = useState<boolean>();
  const { mutateAsync, reset, isError, error } = useMutation(
    course.setCertificateCriteria.mutationOptions(),
  );
  const checked = pending ?? requireQuizPass;

  // The graded-assignments criterion: on while a percentage is stored. The
  // field holds what is typed; it is saved when it loses focus.
  const [uploadPending, setUploadPending] = useState<boolean>();
  const uploadChecked = uploadPending ?? minUploadScorePercent !== undefined;
  const [percentText, setPercentText] = useState<string>();
  const [percentError, setPercentError] = useState<string>();
  const percentValue = percentText ?? String(minUploadScorePercent ?? 60);

  const parsePercent = (text: string) => {
    const n = Number(text);
    return text.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 100
      ? n
      : undefined;
  };
  const saveUpload = async (value: number | null) => {
    if (busy) return;
    reset();
    setPercentError(undefined);
    setUploadPending(value !== null);
    try {
      await mutateAsync({
        courseId,
        requireQuizPass,
        minUploadScorePercent: value,
      });
      await queryClient.invalidateQueries({
        queryKey: course.view.queryKey({ courseId }),
      });
    } catch {
      // Surfaced via the error below; the control goes back to what's saved.
    } finally {
      setUploadPending(undefined);
      setPercentText(undefined);
    }
  };
  const toggleUpload = async () => {
    if (busy) return;
    const value = uploadChecked ? null : parsePercent(percentValue);
    if (!uploadChecked && value === undefined) {
      setPercentError('Enter a whole number from 1 to 100.');
      return;
    }
    await saveUpload(value ?? null);
  };
  const commitPercent = async () => {
    if (busy || !uploadChecked || percentText === undefined) {
      return;
    }
    const value = parsePercent(percentText);
    if (value === undefined) {
      setPercentError('Enter a whole number from 1 to 100.');
    } else if (value === minUploadScorePercent) {
      setPercentText(undefined);
      setPercentError(undefined);
    } else {
      await saveUpload(value);
    }
  };
  const busy = pending !== undefined || uploadPending !== undefined;

  const change = async () => {
    if (busy) return;
    reset();
    setPending(!checked);
    try {
      await mutateAsync({ courseId, requireQuizPass: !checked });
      await queryClient.invalidateQueries({
        queryKey: course.view.queryKey({ courseId }),
      });
    } catch {
      // Surfaced via the error below; the checkbox goes back to what's saved.
    } finally {
      setPending(undefined);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-sm" aria-busy={busy}>
        <label className="flex items-start gap-3 font-medium leading-5">
          <input
            type="checkbox"
            id={`certificate-quiz-pass-${courseId}`}
            checked={checked}
            disabled={!certificatesEnabled}
            onChange={change}
            className="mt-0.5 size-4 shrink-0 accent-primary disabled:opacity-50"
          />
          Require passing every quiz
        </label>
        <p className="ml-7 text-muted-foreground">
          Quizzes with a pass mark of 0% don't count. Applies to students who
          don't have a certificate yet; certificates already issued are not
          affected. Students who qualify after this change get their certificate
          automatically.
        </p>
      </div>
      <div className="text-sm" aria-busy={busy}>
        <div className="flex flex-wrap items-center gap-x-2">
          <label className="flex items-start gap-3 font-medium leading-5">
            <input
              type="checkbox"
              id={`certificate-upload-score-${courseId}`}
              checked={uploadChecked}
              disabled={!certificatesEnabled}
              onChange={toggleUpload}
              className="mt-0.5 size-4 shrink-0 accent-primary disabled:opacity-50"
            />
            Require graded assignments to be returned with at least
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            aria-label="Minimum assignment score, percent"
            aria-invalid={percentError !== undefined}
            className="h-8 w-20"
            value={percentValue}
            disabled={!certificatesEnabled}
            onChange={(event) => {
              if (busy) return;
              setPercentText(event.target.value);
              setPercentError(undefined);
            }}
            onBlur={commitPercent}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitPercent();
              }
            }}
          />
          <span className="font-medium">% of its points</span>
        </div>
        {percentError && (
          <p role="alert" className="ml-7 text-destructive">
            {percentError}
          </p>
        )}
        <p className="ml-7 text-muted-foreground">
          Every assignment students can see counts. Work that is waiting to be
          graded, or was returned with fewer points, does not meet it until it
          is returned with enough.
        </p>
      </div>
      {isError && (
        <ErrorAlert
          type="error"
          header="Couldn't change the certificate criteria"
        >
          {apiErrorMessage(error)}
        </ErrorAlert>
      )}
    </div>
  );
}
