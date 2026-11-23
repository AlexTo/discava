/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@discava/common-shadcn/components/ui/dialog';
import { Progress } from '@discava/common-shadcn/components/ui/progress';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { formatPrice, refundTerms } from '@discava/common-web-utils/price';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { CircleCheck, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { useCoreApi } from '../../../../api';
import { useCheckoutReturn } from './use-checkout-return';

// The refund period core-api applies (REFUND_WINDOW_DAYS), for the terms line
// shown before there is an order to read it from.
const REFUND_WINDOW_DAYS = 14;

const REFUND_POLL_INTERVAL_MS = 2_000;

const errorCode = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code;

// Why enrolling failed, in the student's terms. core-api refuses a course
// that's no longer published (a draft or archived course) with NOT_FOUND.
const enrolErrorMessage = (error: unknown) =>
  errorCode(error) === 'NOT_FOUND'
    ? 'This course is no longer open for enrolment.'
    : errorCode(error) === 'PRECONDITION_FAILED'
      ? 'This course must be purchased'
      : apiErrorMessage(error);

const PAYMENTS_UNAVAILABLE =
  'Payments are unavailable right now. Please try again later.';

// payment.checkout refuses with this while Stripe isn't connected.
const isPaymentsUnavailable = (error: unknown) =>
  errorCode(error) === 'PRECONDITION_FAILED' &&
  ((error as Error).message ?? '').startsWith('Payments are unavailable');

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

// The course page's call to action: sign in, enrol or buy, or continue
// learning, depending on who is looking. Enrolling calls core-api's
// course.enrol, which is idempotent, so a double click or a stale page can't
// enrol twice. A priced course is bought through payment.checkout, which
// sends the student to the hosted payment page; only the enrolment the
// payment creates (read from course.myEnrolment) unlocks the course.
export function EnrolmentActions({
  courseId,
  courseTitle,
  priceAmount = 0,
  priceCurrency = 'USD',
  refundWindowDays = REFUND_WINDOW_DAYS,
  continueTo,
}: {
  courseId: string;
  courseTitle: string;
  priceAmount?: number;
  priceCurrency?: string;
  // The refund period shown beside the price; the API decides the real one.
  refundWindowDays?: number;
  // Where a student who has just enrolled goes on: a lesson they were
  // looking at, such as a free preview. Without it they are sent to their
  // next lesson.
  continueTo?: { lessonId: string };
}) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const [signInOpen, setSignInOpen] = useState(false);
  const [enrolledOpen, setEnrolledOpen] = useState(false);
  // Signing in from here comes back to this course, to finish enrolling.
  const here = useLocation().href;
  const navigate = useNavigate();
  // Enrolling, or returning from a confirmed payment, opens the learner's
  // next lesson. `replace` keeps ?checkout=success out of the history, so
  // Back can't bounce them into the lesson again.
  const startLearning = useCallback(
    (replace: boolean) =>
      void navigate({
        to: '/learn/$courseId/start',
        params: { courseId },
        ...(replace && { replace }),
      }),
    [navigate, courseId],
  );

  const enrolmentQuery = useQuery(
    trpc.course.myEnrolment.queryOptions(
      { courseId },
      { enabled: isAuthenticated },
    ),
  );
  const enrol = useMutation(
    trpc.course.enrol.mutationOptions({
      onSuccess: (enrolment) => {
        queryClient.setQueryData(
          trpc.course.myEnrolment.queryKey({ courseId }),
          enrolment,
        );
        if (continueTo) {
          setEnrolledOpen(true);
        } else {
          startLearning(false);
        }
      },
    }),
  );

  const enrolment = enrolmentQuery.data;
  const enrolled =
    enrolment?.status === 'active' || enrolment?.status === 'completed';
  const onEnrolledAfterCheckout = useCallback(
    () => startLearning(true),
    [startLearning],
  );
  const checkoutReturn = useCheckoutReturn({
    courseId,
    enabled: isAuthenticated && !enrolmentQuery.isPending,
    enrolled,
    onEnrolled: onEnrolledAfterCheckout,
  });

  // A priced course's purchase: whether, and until when, it can be refunded.
  const pricedCourse = priceAmount > 0;
  const orderQuery = useQuery(
    trpc.payment.myOrder.queryOptions(
      { courseId },
      {
        enabled:
          isAuthenticated &&
          pricedCourse &&
          (enrolled || enrolment?.status === 'dropped'),
      },
    ),
  );
  const order = orderQuery.data;
  const refundPending =
    order?.status === 'paid' && order.refundRequestedAt !== undefined;
  const [refundOpen, setRefundOpen] = useState(false);
  const requestRefund = useMutation(
    trpc.payment.requestRefund.mutationOptions({
      onSuccess: ({ refundRequestedAt }) => {
        setRefundOpen(false);
        queryClient.setQueryData(
          trpc.payment.myOrder.queryKey({ courseId }),
          (current) =>
            current && {
              ...current,
              canRequestRefund: false,
              refundRequestedAt,
            },
        );
      },
    }),
  );
  // The refund ends the enrolment once Stripe confirms it, so while one is
  // pending the page asks again, as it does while confirming a payment.
  useEffect(() => {
    if (!refundPending) return;
    const poll = setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: trpc.course.myEnrolment.queryKey({ courseId }),
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.payment.myOrder.queryKey({ courseId }),
      });
    }, REFUND_POLL_INTERVAL_MS);
    return () => clearInterval(poll);
  }, [refundPending, queryClient, trpc, courseId]);

  // A stale page can show a course as free after it got a price.
  const priced =
    priceAmount > 0 || errorCode(enrol.error) === 'PRECONDITION_FAILED';
  const availableQuery = useQuery(
    trpc.payment.available.queryOptions(undefined, {
      enabled: isAuthenticated && priced && !enrolled,
    }),
  );
  const checkout = useMutation(
    trpc.payment.checkout.mutationOptions({
      onSuccess: ({ checkoutUrl }) => window.location.assign(checkoutUrl),
    }),
  );
  const paymentsUnavailable =
    availableQuery.data?.available === false ||
    isPaymentsUnavailable(checkout.error);
  const priceLine = (
    <>
      <p className="text-lg font-semibold">
        {formatPrice(priceAmount, priceCurrency)}
      </p>
      {pricedCourse ? (
        <p className="text-sm text-muted-foreground">
          {refundTerms(refundWindowDays)}
        </p>
      ) : null}
    </>
  );
  const buy = () =>
    paymentsUnavailable ? (
      <ErrorAlert type="info" header="Payments unavailable">
        {PAYMENTS_UNAVAILABLE}
      </ErrorAlert>
    ) : availableQuery.isPending ? (
      <Button className="w-full" size="lg" disabled>
        Checking payment…
      </Button>
    ) : (
      <Button
        className="w-full"
        size="lg"
        disabled={checkout.isPending || checkout.isSuccess}
        onClick={() => checkout.mutate({ courseId })}
      >
        {checkout.isPending || checkout.isSuccess
          ? 'Starting payment…'
          : 'Buy now'}
      </Button>
    );
  const learnLink = (label: string) => (
    <Button className="w-full" size="lg" asChild>
      <Link to="/learn/$courseId/home" params={{ courseId }}>
        {label}
      </Link>
    </Button>
  );

  // What a student who bought the course can do about a refund.
  const refundSection =
    order?.status !== 'paid' ? null : order.refundRequestedAt ? (
      <p className="text-sm text-muted-foreground">
        Refund requested on {formatDate(order.refundRequestedAt)}. Your access
        ends when it is confirmed.
      </p>
    ) : order.canRequestRefund ? (
      <>
        <p className="text-sm text-muted-foreground">
          You can request a refund until {formatDate(order.refundableUntil)}.
        </p>
        <Button
          className="w-full"
          variant="outline"
          onClick={() => setRefundOpen(true)}
        >
          Request a refund
        </Button>
      </>
    ) : order.refundBlockedBy === 'window-ended' ? (
      <p className="text-sm text-muted-foreground">
        The refund period for this course ended on{' '}
        {formatDate(order.refundableUntil)}.
      </p>
    ) : order.refundBlockedBy === 'completed' ? (
      <p className="text-sm text-muted-foreground">
        A course can't be refunded after you have completed it.
      </p>
    ) : order.refundBlockedBy === 'other-account' ? (
      <p className="text-sm text-muted-foreground">
        This purchase can't be refunded here right now.
      </p>
    ) : null;

  let action: React.ReactNode;
  if (!isAuthenticated) {
    action = (
      <>
        {priceLine}
        <Button
          className="w-full"
          size="lg"
          onClick={() => setSignInOpen(true)}
        >
          {priced ? 'Sign in to buy' : 'Enrol now'}
        </Button>
      </>
    );
  } else if (enrolmentQuery.isPending) {
    action = (
      <Button className="w-full" size="lg" disabled>
        Checking your enrolment…
      </Button>
    );
  } else if (enrolment?.status === 'active') {
    action = (
      <>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Enrolled</span>
            <span className="text-muted-foreground">
              {enrolment.progressPercent}% complete
            </span>
          </div>
          <Progress
            value={enrolment.progressPercent}
            aria-label="Course progress"
          />
        </div>
        {learnLink(
          enrolment.progressPercent > 0
            ? 'Continue learning'
            : 'Start learning',
        )}
        {refundSection}
      </>
    );
  } else if (enrolment?.status === 'completed') {
    action = (
      <>
        <Badge
          variant="secondary"
          className="w-full justify-center gap-1.5 py-1.5 text-xs font-medium"
        >
          <CircleCheck className="size-3.5" /> Completed
          {enrolment.completedAt
            ? ` on ${formatDate(enrolment.completedAt)}`
            : ''}
        </Badge>
        {learnLink('Review course')}
        {refundSection}
      </>
    );
  } else if (checkoutReturn.status === 'confirming') {
    action = (
      <div className="space-y-1.5" role="status">
        <p className="text-sm font-medium">Confirming your payment</p>
        <Progress aria-label="Confirming your payment" />
      </div>
    );
  } else if (checkoutReturn.status === 'timed-out') {
    action = (
      <>
        <ErrorAlert type="info" header="Still confirming">
          Your payment is still being confirmed. It is not lost: refresh in a
          minute.
        </ErrorAlert>
        <Button
          className="w-full"
          size="lg"
          variant="outline"
          onClick={() => window.location.reload()}
        >
          Refresh
        </Button>
      </>
    );
  } else if (enrolment?.status === 'dropped') {
    // A refunded or dropped student can buy a priced course again, or enrol
    // again in a free one (the API restores the enrolment, progress intact).
    action = (
      <>
        <ErrorAlert header="You're no longer enrolled">
          Your enrolment has ended.
          {order?.status === 'refunded' && order.refundedAt
            ? ` Refunded on ${formatDate(order.refundedAt)}.`
            : ''}
        </ErrorAlert>
        {priced ? (
          buy()
        ) : (
          <Button
            className="w-full"
            size="lg"
            disabled={enrol.isPending}
            onClick={() => enrol.mutate({ courseId })}
          >
            {enrol.isPending ? 'Enrolling…' : 'Enrol now'}
          </Button>
        )}
      </>
    );
  } else if (priced) {
    action = (
      <>
        {priceLine}
        {checkoutReturn.result === 'cancelled' ? (
          <ErrorAlert type="info" header="Payment cancelled">
            Payment cancelled. You have not been charged.
          </ErrorAlert>
        ) : null}
        {buy()}
      </>
    );
  } else {
    action = (
      <>
        {priceLine}
        <Button
          className="w-full"
          size="lg"
          disabled={enrol.isPending}
          onClick={() => enrol.mutate({ courseId })}
        >
          {enrol.isPending ? 'Enrolling…' : 'Enrol now'}
        </Button>
      </>
    );
  }

  return (
    <>
      {isAuthenticated && enrolmentQuery.isError ? (
        <ErrorAlert
          type="error"
          header="Couldn't check your enrolment"
          onRetry={() => enrolmentQuery.refetch()}
        >
          {apiErrorMessage(enrolmentQuery.error)}
        </ErrorAlert>
      ) : null}
      {action}
      {enrol.isError ? (
        <ErrorAlert type="error" header="Couldn't enrol you">
          {enrolErrorMessage(enrol.error)}
        </ErrorAlert>
      ) : null}
      {checkout.isError && !isPaymentsUnavailable(checkout.error) ? (
        <ErrorAlert type="error" header="Couldn't start payment">
          {apiErrorMessage(checkout.error)}
        </ErrorAlert>
      ) : null}

      {continueTo ? (
        <Dialog open={enrolledOpen} onOpenChange={setEnrolledOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-center">You're enrolled</DialogTitle>
              <DialogDescription className="text-center">
                You can now take all of {courseTitle}.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-center">
              <Button asChild>
                <Link
                  to="/learn/$courseId/lesson/$lessonId"
                  params={{ courseId, lessonId: continueTo.lessonId }}
                >
                  Start this lesson
                </Link>
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a refund</DialogTitle>
            <DialogDescription>
              {order
                ? `You will be refunded ${formatPrice(order.amount, order.currency)}. `
                : ''}
              Your access to {courseTitle} ends when the refund is confirmed.
              Your progress is kept.
            </DialogDescription>
          </DialogHeader>
          {requestRefund.isError ? (
            <ErrorAlert type="error" header="Couldn't request the refund">
              {apiErrorMessage(requestRefund.error)}
            </ErrorAlert>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              disabled={requestRefund.isPending}
              onClick={() => requestRefund.mutate({ courseId })}
            >
              {requestRefund.isPending ? 'Requesting…' : 'Request refund'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-6" />
            </div>
            <DialogTitle className="text-center">
              {priced ? 'Sign in to buy' : 'Sign in to enrol'}
            </DialogTitle>
            <DialogDescription className="text-center">
              Create or sign in to your account to {priced ? 'buy' : 'enrol in'}{' '}
              {courseTitle}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button asChild>
              <Link to="/signin" search={{ redirect: here }}>
                Continue to sign in
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
