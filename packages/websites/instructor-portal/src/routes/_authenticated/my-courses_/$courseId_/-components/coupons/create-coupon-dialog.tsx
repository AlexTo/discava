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
import { parsePriceInput } from '@discava/common-web-utils/price';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';
import { todayUtc } from './coupon-format';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs disabled:opacity-50';

const isDuplicate = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code === 'CONFLICT';

/**
 * Makes a code. The code is optional: left empty, the server draws one. A
 * duplicate shows on the Code field; any other refusal shows in the dialog.
 */
export function CreateCouponDialog({
  courseId,
  currency,
  open,
  onOpenChange,
  onCreated,
}: {
  courseId: string;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (code: string) => void;
}) {
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const create = useMutation(trpc.coupon.create.mutationOptions());
  const [code, setCode] = useState('');
  const [type, setType] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [limit, setLimit] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const reset = () => {
    setCode('');
    setType('percent');
    setValue('');
    setExpiresOn('');
    setLimit('');
    setProblem(null);
    create.reset();
  };

  const submit = async () => {
    if (create.isPending) {
      return;
    }
    setProblem(null);
    let amount: number | undefined;
    if (type === 'percent') {
      const percent = /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
      amount = percent >= 1 && percent <= 100 ? percent : undefined;
      if (amount === undefined) {
        setProblem('Enter a whole percentage from 1 to 100');
        return;
      }
    } else {
      amount = parsePriceInput(value);
      if (amount === undefined || amount < 1) {
        setProblem('Enter an amount with at most two decimals, at least 1.00');
        return;
      }
    }
    let maxRedemptions: number | undefined;
    if (limit.trim() !== '') {
      maxRedemptions = /^\d+$/.test(limit.trim())
        ? Number(limit.trim())
        : Number.NaN;
      if (!(maxRedemptions >= 1)) {
        setProblem(
          'The maximum redemptions must be a whole number, at least 1',
        );
        return;
      }
    }
    try {
      const created = await create.mutateAsync({
        courseId,
        ...(code.trim() !== '' && { code: code.trim() }),
        type,
        value: amount,
        ...(expiresOn !== '' && { expiresOn }),
        ...(maxRedemptions !== undefined && { maxRedemptions }),
      });
      onCreated(created.code);
    } catch {
      // Shown in the dialog.
      return;
    }
    reset();
    onOpenChange(false);
    void queryClient.invalidateQueries(trpc.coupon.list.pathFilter());
  };

  const duplicate = create.isError && isDuplicate(create.error);
  const pending = create.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create code</DialogTitle>
            <DialogDescription>
              Students enter the code at checkout to pay less for this course.
            </DialogDescription>
          </DialogHeader>

          {(problem || (create.isError && !duplicate)) && (
            <ErrorAlert type="error" header="Couldn't create the code">
              {problem ?? apiErrorMessage(create.error)}
            </ErrorAlert>
          )}

          <div className="space-y-2">
            <Label htmlFor="coupon-code">Code (optional)</Label>
            <div className="flex gap-2">
              <Input
                id="coupon-code"
                value={code}
                disabled={pending}
                autoComplete="off"
                aria-invalid={duplicate || undefined}
                aria-describedby="coupon-code-help"
                onChange={(event) => {
                  setCode(event.target.value);
                  create.reset();
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setCode('')}
              >
                Generate
              </Button>
            </div>
            <p
              id="coupon-code-help"
              className={
                duplicate
                  ? 'text-sm text-destructive'
                  : 'text-xs text-muted-foreground'
              }
            >
              {duplicate
                ? apiErrorMessage(create.error)
                : 'Leave empty to generate a code, or enter 4 to 24 letters, digits or dashes.'}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="coupon-type">Type</Label>
              <select
                id="coupon-type"
                className={SELECT_CLASS}
                value={type}
                disabled={pending}
                onChange={(event) =>
                  setType(event.target.value as 'percent' | 'fixed')
                }
              >
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="coupon-value">
                {type === 'percent' ? 'Percent' : `Amount (${currency})`}
              </Label>
              <Input
                id="coupon-value"
                inputMode="decimal"
                value={value}
                disabled={pending}
                autoComplete="off"
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="coupon-expires">Expires on (optional)</Label>
              <Input
                id="coupon-expires"
                type="date"
                min={todayUtc()}
                value={expiresOn}
                disabled={pending}
                aria-describedby="coupon-expires-help"
                onChange={(event) => setExpiresOn(event.target.value)}
              />
              <p
                id="coupon-expires-help"
                className="text-xs text-muted-foreground"
              >
                Ends at the end of that day, UTC
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="coupon-limit">
                Maximum redemptions (optional)
              </Label>
              <Input
                id="coupon-limit"
                inputMode="numeric"
                value={limit}
                disabled={pending}
                autoComplete="off"
                onChange={(event) => setLimit(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <PendingButton
              type="submit"
              pending={pending}
              pendingLabel="Creating…"
            >
              Create
            </PendingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
