/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';

/**
 * What a student needs besides completing the course to get a certificate:
 * today, passing every quiz that has a pass mark. It shows the saved value; a
 * failed save puts the checkbox back.
 */
export function CourseCertificateCriteria({
  courseId,
  certificatesEnabled,
  requireQuizPass,
}: {
  courseId: string;
  certificatesEnabled: boolean;
  requireQuizPass: boolean;
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

  const change = async () => {
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
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id={`certificate-quiz-pass-${courseId}`}
          checked={checked}
          disabled={!certificatesEnabled || pending !== undefined}
          onChange={change}
          className="mt-1 size-4 shrink-0 accent-primary disabled:opacity-50"
        />
        <div className="text-sm">
          <label
            htmlFor={`certificate-quiz-pass-${courseId}`}
            className="font-medium leading-5"
          >
            Require passing every quiz
          </label>
          <p className="text-muted-foreground">
            Quizzes with a pass mark of 0% don't count. Applies to students who
            don't have a certificate yet; certificates already issued are not
            affected. Students who qualify after this change get their
            certificate automatically.
          </p>
        </div>
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
