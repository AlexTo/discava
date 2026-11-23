/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@discava/common-shadcn/components/ui/dialog';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import { type CouponItem, expiresOnOf, todayUtc } from './coupon-format';

/**
 * Changes a code's expiry and limit, nothing else: its code, type and value
 * are fixed once it is made. An empty field clears that setting. A refusal,
 * such as a limit below the redemptions held, shows in the dialog, which stays
 * open with what was typed.
 */
export function EditLimitsDialog({
  courseId,
  coupon,
  open,
  onOpenChange,
}: {
  courseId: string;
  coupon: CouponItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const update = useMutation(trpc.coupon.update.mutationOptions());
  const [expiresOn, setExpiresOn] = useState(expiresOnOf(coupon));
  const [limit, setLimit] = useState(
    coupon.maxRedemptions === undefined ? '' : String(coupon.maxRedemptions),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const { redeemedCount } = coupon;

  const close = () => {
    setExpiresOn(expiresOnOf(coupon));
    setLimit(
      coupon.maxRedemptions === undefined ? '' : String(coupon.maxRedemptions),
    );
    setProblem(null);
    update.reset();
    onOpenChange(false);
  };

  const save = async () => {
    if (update.isPending) {
      return;
    }
    setProblem(null);
    let maxRedemptions: number | null = null;
    if (limit.trim() !== '') {
      maxRedemptions = /^\d+$/.test(limit.trim())
        ? Number(limit.trim())
        : Number.NaN;
      if (!(maxRedemptions >= 1)) {
        setProblem('The limit must be a whole number, at least 1');
        return;
      }
    }
    try {
      await update.mutateAsync({
        courseId,
        code: coupon.code,
        expiresOn: expiresOn === '' ? null : expiresOn,
        maxRedemptions,
      });
    } catch {
      // Shown in the dialog.
      return;
    }
    close();
    void queryClient.invalidateQueries(trpc.coupon.list.pathFilter());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>{`Edit limits for ${coupon.code}`}</DialogTitle>
            <DialogDescription>
              The code, type and value of a code can't be changed. Disable it
              and make a new one instead.
            </DialogDescription>
          </DialogHeader>

          {(problem || update.isError) && (
            <ErrorAlert type="error" header="Couldn't save the limits">
              {problem ?? apiErrorMessage(update.error)}
            </ErrorAlert>
          )}

          <div className="space-y-2">
            <Label htmlFor={`edit-expires-${coupon.code}`}>Expires on</Label>
            <Input
              id={`edit-expires-${coupon.code}`}
              type="date"
              min={todayUtc()}
              value={expiresOn}
              disabled={update.isPending}
              aria-describedby={`edit-expires-help-${coupon.code}`}
              onChange={(event) => setExpiresOn(event.target.value)}
            />
            <p
              id={`edit-expires-help-${coupon.code}`}
              className="text-xs text-muted-foreground"
            >
              Ends at the end of that day, UTC. Leave empty for no expiry.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`edit-limit-${coupon.code}`}>
              Maximum redemptions
            </Label>
            <Input
              id={`edit-limit-${coupon.code}`}
              inputMode="numeric"
              value={limit}
              disabled={update.isPending}
              autoComplete="off"
              aria-describedby={`edit-limit-help-${coupon.code}`}
              onChange={(event) => setLimit(event.target.value)}
            />
            <p
              id={`edit-limit-help-${coupon.code}`}
              className="text-xs text-muted-foreground"
            >
              {`At least ${redeemedCount}, the redemptions already held. Leave empty for no limit.`}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={update.isPending}
              onClick={close}
            >
              Cancel
            </Button>
            <PendingButton
              type="submit"
              pending={update.isPending}
              pendingLabel="Saving…"
            >
              Save
            </PendingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
