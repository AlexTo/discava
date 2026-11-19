/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { cn } from '@discava/common-shadcn/lib/utils';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';

/**
 * Whether completing the course issues a certificate (#276). It shows the
 * saved state; a failed save puts the switch back.
 */
export function CourseCertificatesSwitch({
  courseId,
  certificatesEnabled,
}: {
  courseId: string;
  certificatesEnabled: boolean;
}) {
  const { course } = useInstructorApi();
  const queryClient = useQueryClient();
  // What the switch shows while a save is in flight; the saved value
  // otherwise.
  const [pending, setPending] = useState<boolean>();
  const { mutateAsync, reset, isError, error } = useMutation(
    course.setCertificates.mutationOptions(),
  );
  const checked = pending ?? certificatesEnabled;

  const change = async () => {
    reset();
    setPending(!checked);
    try {
      await mutateAsync({ courseId, enabled: !checked });
      await queryClient.invalidateQueries({
        queryKey: course.view.queryKey({ courseId }),
      });
    } catch {
      // Surfaced via the error below; the switch goes back to what's saved.
    } finally {
      setPending(undefined);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          id={`certificates-${courseId}`}
          aria-checked={checked}
          disabled={pending !== undefined}
          onClick={change}
          className={cn(
            'mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors disabled:opacity-50',
            checked ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            className={cn(
              'block size-4 rounded-full bg-background shadow transition-transform',
              checked ? 'translate-x-4' : 'translate-x-0.5',
            )}
          />
        </button>
        <div className="text-sm">
          <label
            htmlFor={`certificates-${courseId}`}
            className="font-medium leading-5"
          >
            Issue a certificate on completion
          </label>
          <p className="text-muted-foreground">
            Applies to students who complete the course from now on;
            certificates already issued stay valid.
          </p>
        </div>
      </div>
      {isError && (
        <ErrorAlert
          type="error"
          header="Couldn't change the certificate setting"
        >
          {apiErrorMessage(error)}
        </ErrorAlert>
      )}
    </div>
  );
}
