/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { formatPrice } from '@discava/common-web-utils/price';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useCoreApi } from '../../../../api';

/** What `coupon.preview` answered for the code the student applied. */
export interface AppliedCoupon {
  code: string;
  listAmount: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
  isFree: boolean;
}

// The code field of the pay area: a "Have a code?" link, the field with
// Apply, and once applied the price summary with Remove code. The preview only
// reads: nothing is reserved until the student pays, and the server prices the
// order again then. The parent keeps the applied code so its pay button can
// pass it and show the total.
export function CouponField({
  courseId,
  applied,
  onApply,
  onRemove,
}: {
  courseId: string;
  applied: AppliedCoupon | null;
  onApply: (coupon: AppliedCoupon) => void;
  onRemove: () => void;
}) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string>();

  const apply = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setApplying(true);
    setError(undefined);
    try {
      const preview = await queryClient.fetchQuery({
        ...trpc.coupon.preview.queryOptions({ courseId, code }),
        staleTime: 0,
        retry: false,
      });
      onApply(preview);
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      setApplying(false);
    }
  };

  if (applied) {
    return (
      <div className="space-y-2" aria-label="Price with code">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>List price</dt>
            <dd>{formatPrice(applied.listAmount, applied.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Discount ({applied.code})</dt>
            <dd>−{formatPrice(applied.discountAmount, applied.currency)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>Total</dt>
            <dd>{formatPrice(applied.totalAmount, applied.currency)}</dd>
          </div>
        </dl>
        <Button
          className="w-full"
          variant="outline"
          onClick={() => {
            setCode('');
            setError(undefined);
            setOpen(false);
            onRemove();
          }}
        >
          Remove code
        </Button>
      </div>
    );
  }

  if (!open) {
    return (
      <Button
        className="h-auto p-0"
        variant="link"
        onClick={() => setOpen(true)}
      >
        Have a code?
      </Button>
    );
  }

  return (
    <form className="space-y-2" onSubmit={apply}>
      <Label htmlFor={`coupon-code-${courseId}`}>Discount code</Label>
      <div className="flex gap-2">
        <Input
          id={`coupon-code-${courseId}`}
          value={code}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `coupon-error-${courseId}` : undefined}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button type="submit" disabled={applying || !code.trim()}>
          {applying ? 'Applying…' : 'Apply'}
        </Button>
      </div>
      {error ? (
        <p
          id={`coupon-error-${courseId}`}
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
