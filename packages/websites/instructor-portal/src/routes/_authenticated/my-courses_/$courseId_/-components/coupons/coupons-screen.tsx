/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { LoadingState } from '@discava/common-shadcn/components/loading-state';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import { CouponRow } from './coupon-row';
import { CreateCouponDialog } from './create-coupon-dialog';

/**
 * A course's discount codes. A free course has nothing to discount, so it
 * shows a message and no way to create a code.
 */
export function CouponsScreen({ courseId }: { courseId: string }) {
  const trpc = useInstructorApi();
  const courseQuery = useQuery(trpc.course.view.queryOptions({ courseId }));
  const couponsQuery = useQuery(trpc.coupon.list.queryOptions({ courseId }));
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const failed = courseQuery.isError || couponsQuery.isError;
  if (failed) {
    return (
      <ErrorAlert
        type="error"
        header="Couldn't load the codes"
        onRetry={() => {
          if (courseQuery.isError) {
            void courseQuery.refetch();
          }
          if (couponsQuery.isError) {
            void couponsQuery.refetch();
          }
        }}
      >
        {apiErrorMessage(
          couponsQuery.isError ? couponsQuery.error : courseQuery.error,
        )}
      </ErrorAlert>
    );
  }
  if (courseQuery.isPending || couponsQuery.isPending) {
    return <LoadingState label="Loading codes…" />;
  }

  const { priceAmount, priceCurrency } = courseQuery.data;
  const items = couponsQuery.data.items;
  const free = priceAmount <= 0;

  return (
    <div className="space-y-4">
      <StatusMessage message={status} />
      {free && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Set a price on this course to create codes
        </p>
      ) : (
        <>
          {!free && items.length > 0 && (
            <div>
              <Button type="button" onClick={() => setCreating(true)}>
                Create code
              </Button>
            </div>
          )}
          {items.length === 0 ? (
            <div className="space-y-3 rounded-xl border p-6">
              <p className="text-sm text-muted-foreground">No codes yet</p>
              <Button type="button" onClick={() => setCreating(true)}>
                Create code
              </Button>
            </div>
          ) : (
            <ul aria-label="Codes" className="divide-y rounded-xl border">
              {items.map((coupon) => (
                <CouponRow
                  key={coupon.code}
                  courseId={courseId}
                  coupon={coupon}
                  onChanged={setStatus}
                />
              ))}
            </ul>
          )}
          {free && (
            <p className="text-sm text-muted-foreground">
              Set a price on this course to create codes
            </p>
          )}
        </>
      )}
      {!free && (
        <CreateCouponDialog
          courseId={courseId}
          currency={priceCurrency}
          open={creating}
          onOpenChange={setCreating}
          onCreated={(code) => setStatus(`Created ${code}`)}
        />
      )}
    </div>
  );
}
