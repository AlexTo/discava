/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IRefundFailures } from '@discava/admin-api';
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { formatPrice } from '@discava/common-web-utils/price';
import { formatWhen } from './format';

// Students who bought a course again after a refund and whose first refund
// then failed: they paid twice. Support refunds them by hand.
export function RefundFailures({
  failures,
}: {
  failures: IRefundFailures['failures'];
}) {
  if (failures.length === 0) {
    return null;
  }
  return (
    <section className="space-y-2">
      <ErrorAlert header="Refunds that failed">
        These students bought a course again after a refund, then Stripe failed
        the refund. They have paid twice and been told to contact support.
        Refund them another way.
      </ErrorAlert>
      <h2 id="refund-failures" className="text-lg font-semibold">
        Failed refunds
      </h2>
      <div
        role="region"
        aria-labelledby="refund-failures"
        tabIndex={0}
        className="overflow-x-auto"
      >
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium first:pl-0">Student</th>
              <th className="px-2 py-2 font-medium">Course</th>
              <th className="px-2 py-2 font-medium">Amount</th>
              <th className="px-2 py-2 font-medium">Payment intent</th>
              <th className="px-2 py-2 font-medium last:pr-0">Failed</th>
            </tr>
          </thead>
          <tbody>
            {failures.map((failure) => (
              <tr key={failure.orderId} className="border-b">
                <td className="break-words px-2 py-2 first:pl-0">
                  {failure.studentName}
                </td>
                <td className="break-words px-2 py-2">{failure.courseTitle}</td>
                <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                  {formatPrice(failure.amount, failure.currency)}
                </td>
                <td className="break-all px-2 py-2">
                  {failure.paymentIntentId ?? ''}
                </td>
                <td className="whitespace-nowrap px-2 py-2 tabular-nums last:pr-0">
                  {formatWhen(failure.refundFailedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
