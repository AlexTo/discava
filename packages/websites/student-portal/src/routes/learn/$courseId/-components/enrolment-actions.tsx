/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from '@tanstack/react-router';
import { CircleCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Alert } from '../../../../components/alert';
import { useCoreApi } from '../../../../hooks/useCoreApi';

const errorCode = (error: unknown) =>
  (error as { data?: { code?: string } } | null)?.data?.code;

// Why enrolling failed, in the student's terms. core-api refuses a course
// that's no longer published (a draft or archived course) with NOT_FOUND.
const enrolErrorMessage = (error: unknown) =>
  errorCode(error) === 'NOT_FOUND'
    ? 'This course is no longer open for enrolment.'
    : ((error as Error | null)?.message ?? 'Something went wrong.');

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

// The course preview's call to action: sign in, enrol, or continue learning,
// depending on who is looking. Enrolling calls core-api's course.enrol, which
// is idempotent, so a double click or a stale page can't enrol twice.
export function EnrolmentActions({
  courseId,
  courseTitle,
}: {
  courseId: string;
  courseTitle: string;
}) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const [signInOpen, setSignInOpen] = useState(false);
  const [enrolledOpen, setEnrolledOpen] = useState(false);
  // Signing in from here comes back to this course, to finish enrolling.
  const here = useLocation().href;

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
        setEnrolledOpen(true);
      },
    }),
  );

  const enrolment = enrolmentQuery.data;
  const learnLink = (label: string) => (
    <Button className="w-full" size="lg" asChild>
      <Link to="/learn/$courseId/home" params={{ courseId }}>
        {label}
      </Link>
    </Button>
  );

  let action: React.ReactNode;
  if (!isAuthenticated) {
    action = (
      <Button className="w-full" size="lg" onClick={() => setSignInOpen(true)}>
        Enrol now
      </Button>
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
      </>
    );
  } else if (enrolment?.status === 'dropped') {
    // Enrolling again returns the dropped enrolment, so there's nothing to
    // offer here yet.
    action = (
      <Alert header="You're no longer enrolled">
        Your enrolment in this course has ended.
      </Alert>
    );
  } else {
    action = (
      <Button
        className="w-full"
        size="lg"
        disabled={enrol.isPending}
        onClick={() => enrol.mutate({ courseId })}
      >
        {enrol.isPending ? 'Enrolling…' : 'Enrol now'}
      </Button>
    );
  }

  return (
    <>
      {isAuthenticated && enrolmentQuery.isError ? (
        <Alert type="error" header="Couldn't check your enrolment">
          {apiErrorMessage(enrolmentQuery.error)}
        </Alert>
      ) : null}
      {action}
      {enrol.isError ? (
        <Alert type="error" header="Couldn't enrol you">
          {enrolErrorMessage(enrol.error)}
        </Alert>
      ) : null}

      <Dialog open={enrolledOpen} onOpenChange={setEnrolledOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CircleCheck className="size-6" />
            </div>
            <DialogTitle className="text-center">You're enrolled!</DialogTitle>
            <DialogDescription className="text-center">
              You're now enrolled in {courseTitle}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <DialogClose asChild>
              <Button variant="outline">Keep browsing</Button>
            </DialogClose>
            <Button asChild>
              <Link to="/learn/$courseId/home" params={{ courseId }}>
                Start learning
              </Link>
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
            <DialogTitle className="text-center">Sign in to enrol</DialogTitle>
            <DialogDescription className="text-center">
              Create or sign in to your account to enrol in {courseTitle}.
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
