/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import {
  parsePriceInput,
  SUPPORTED_CURRENCIES,
  validatePrice,
} from '@discava/common-web-utils/price';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs disabled:opacity-50';

const FORMAT_RULE =
  'Enter 0 for free, or a price with at most two decimals (minimum 1.00, maximum 10,000.00)';

// The amount as the field shows it ("19.99", "0" for free), built from the
// whole and fractional parts so no floating point rounding is involved.
const toFieldValue = (amount: number) =>
  amount === 0
    ? '0'
    : `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;

/**
 * What the course costs. It shows the saved price; a failed save keeps what was typed.
 * A change applies to new purchases only: enrolled students keep their access.
 */
export function CoursePriceForm({
  courseId,
  priceAmount,
  priceCurrency,
}: {
  courseId: string;
  priceAmount: number;
  priceCurrency: string;
}) {
  const { course } = useInstructorApi();
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(toFieldValue(priceAmount));
  const [currency, setCurrency] = useState(priceCurrency);
  const [problem, setProblem] = useState<string>();
  const [saved, setSaved] = useState(false);
  const { mutateAsync, reset, isPending, isError, error } = useMutation(
    course.setPrice.mutationOptions(),
  );

  const handleSave = async () => {
    reset();
    setSaved(false);
    const amount = parsePriceInput(price);
    const invalid =
      amount === undefined
        ? FORMAT_RULE
        : validatePrice({ amount, currency: currency });
    if (amount === undefined || invalid) {
      setProblem(invalid);
      return;
    }
    setProblem(undefined);
    try {
      await mutateAsync({
        courseId,
        priceAmount: amount,
        priceCurrency: currency,
      });
    } catch {
      // Surfaced via the error below; what was typed stays, to send again.
      return;
    }
    setSaved(true);
    await queryClient.invalidateQueries({
      queryKey: course.view.queryKey({ courseId }),
    });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      {isError && (
        <ErrorAlert type="error" header="Couldn't save the price">
          {apiErrorMessage(error)}
        </ErrorAlert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`price-${courseId}`}>Price</Label>
          <Input
            id={`price-${courseId}`}
            inputMode="decimal"
            value={price}
            aria-invalid={problem !== undefined}
            aria-describedby={`price-help-${courseId}`}
            disabled={isPending}
            onChange={(event) => {
              setPrice(event.target.value);
              setProblem(undefined);
              setSaved(false);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`price-currency-${courseId}`}>Currency</Label>
          <select
            id={`price-currency-${courseId}`}
            className={SELECT_CLASS}
            value={currency}
            disabled={isPending}
            onChange={(event) => {
              setCurrency(event.target.value);
              setSaved(false);
            }}
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p
        id={`price-help-${courseId}`}
        className={
          problem ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'
        }
        role={problem ? 'alert' : undefined}
      >
        {problem ??
          'Students who are already enrolled keep their access; the new price applies to new purchases.'}
      </p>
      <div className="flex items-center gap-3">
        <PendingButton type="submit" pending={isPending} pendingLabel="Saving…">
          Save price
        </PendingButton>
        <StatusMessage message={saved ? 'Saved' : null} />
      </div>
    </form>
  );
}
