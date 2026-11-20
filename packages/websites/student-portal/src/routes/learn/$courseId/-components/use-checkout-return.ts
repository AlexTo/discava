/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useCoreApi } from '../../../../api';

const POLL_INTERVAL_MS = 2_000;
const GIVE_UP_AFTER_MS = 60_000;

export type CheckoutReturn = {
  // What the address says Stripe's hosted page did; nothing else is trusted.
  result: 'success' | 'cancelled' | undefined;
  // `confirming` while the enrolment is awaited, `timed-out` once it hasn't
  // appeared within a minute.
  status: 'idle' | 'confirming' | 'timed-out';
};

// The course page after the hosted payment page sent the student back with
// `?checkout=success`. The address proves nothing, so while the student is
// not enrolled this refetches `course.myEnrolment` every 2 s for up to 60 s
// and reports the state; the enrolment appearing is the only thing that
// grants access. `onEnrolled` runs once whenever the address says
// `checkout=success` and the student is enrolled: after waiting for the
// enrolment, or when it was already there on the first read.
export function useCheckoutReturn({
  courseId,
  enabled,
  enrolled,
  onEnrolled,
}: {
  courseId: string;
  // Signed in, and the enrolment has been read at least once.
  enabled: boolean;
  enrolled: boolean;
  onEnrolled: () => void;
}): CheckoutReturn {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const { checkout } = useLocation({
    select: (location) => location.search,
  }) as {
    checkout?: unknown;
  };
  const result =
    checkout === 'success' || checkout === 'cancelled' ? checkout : undefined;

  const waiting = result === 'success' && enabled && !enrolled;
  const [timedOut, setTimedOut] = useState(false);
  const notified = useRef(false);

  useEffect(() => {
    if (!waiting) return;
    const poll = setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: trpc.course.myEnrolment.queryKey({ courseId }),
      });
    }, POLL_INTERVAL_MS);
    const giveUp = setTimeout(() => {
      clearInterval(poll);
      setTimedOut(true);
    }, GIVE_UP_AFTER_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [waiting, queryClient, trpc, courseId]);

  useEffect(() => {
    if (result === 'success' && enabled && enrolled && !notified.current) {
      notified.current = true;
      onEnrolled();
    }
  }, [result, enabled, enrolled, onEnrolled]);

  return {
    result,
    status: !waiting ? 'idle' : timedOut ? 'timed-out' : 'confirming',
  };
}
