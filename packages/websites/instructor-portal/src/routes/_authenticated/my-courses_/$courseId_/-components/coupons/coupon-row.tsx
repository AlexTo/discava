/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import {
  type CouponItem,
  describeExpiry,
  describeUse,
  describeValue,
} from './coupon-format';
import { CouponStatusBadge } from './coupon-status-badge';
import { DeleteCouponDialog } from './delete-coupon-dialog';
import { EditLimitsDialog } from './edit-limits-dialog';

/** One code with its actions: Disable or Enable, Edit limits, Delete. */
export function CouponRow({
  courseId,
  coupon,
  onChanged,
}: {
  courseId: string;
  coupon: CouponItem;
  onChanged: (message: string) => void;
}) {
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const update = useMutation(trpc.coupon.update.mutationOptions());
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggle = async () => {
    if (update.isPending) {
      return;
    }
    try {
      await update.mutateAsync({
        courseId,
        code: coupon.code,
        enabled: !coupon.enabled,
      });
    } catch {
      // Shown under the row.
      return;
    }
    onChanged(`${coupon.code} ${coupon.enabled ? 'disabled' : 'enabled'}`);
    void queryClient.invalidateQueries(trpc.coupon.list.pathFilter());
  };

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono font-semibold">
              {coupon.code}
            </span>
            <CouponStatusBadge status={coupon.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {[
              describeValue(coupon),
              describeExpiry(coupon),
              describeUse(coupon),
            ].join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={update.isPending || undefined}
            aria-label={`${coupon.enabled ? 'Disable' : 'Enable'} ${coupon.code}`}
            onClick={() => void toggle()}
          >
            {coupon.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={`Edit limits for ${coupon.code}`}
            onClick={() => setEditing(true)}
          >
            Edit limits
          </Button>
          {coupon.redeemedCount === 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Delete ${coupon.code}`}
              onClick={() => setDeleting(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
      {update.isError && (
        <ErrorAlert type="error" header={`Couldn't update ${coupon.code}`}>
          {apiErrorMessage(update.error)}
        </ErrorAlert>
      )}
      {editing && (
        <EditLimitsDialog
          courseId={courseId}
          coupon={coupon}
          open
          onOpenChange={setEditing}
        />
      )}
      <DeleteCouponDialog
        courseId={courseId}
        code={coupon.code}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => onChanged(`${coupon.code} deleted`)}
      />
    </li>
  );
}
