/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { CoursePage } from './course-page';
import { EnrolmentActions } from './enrolment-actions';

// There's no route tree in these renders; navigation is a spy.
const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { mockRouter } = await import('@discava/common-web-utils/testing');
  return mockRouter(importOriginal, { useNavigate: () => navigate });
});

afterEach(() => navigate.mockReset());

const START = {
  to: '/learn/$courseId/start',
  params: { courseId: 'course-1' },
};

const course = {
  courseId: 'course-1',
  title: 'Linear Algebra',
  description: 'Vectors, matrices and the four subspaces.',
  status: 'published',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  modules: [
    {
      moduleId: 'module-1',
      title: 'Unit 1',
      lessons: [{ lessonId: 'lesson-1', title: 'Lecture 1' }],
    },
  ],
};

const enrolment = (overrides: Record<string, unknown> = {}) => ({
  courseId: 'course-1',
  userId: 'student-1',
  status: 'active',
  progressPercent: 0,
  paidFor: false,
  refundedBefore: false,
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

const renderPreview = (
  handlers: Record<string, Handler> = {},
  { signedIn = true, path = '/' } = {},
) =>
  renderWithCoreApi(<CoursePage courseId="course-1" />, {
    signedIn,
    path,
    handlers: {
      'course.publicView': () => course,
      // The page's Reviews section reads these; these tests are not about it.
      'review.summary': () => ({
        count: 0,
        stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      }),
      'review.list': () => ({ items: [], cursor: null }),
      'review.mine': () => null,
      ...handlers,
    },
  });

const enrolButton = () => screen.findByRole('button', { name: 'Enrol now' });

describe('EnrolmentActions', () => {
  it('asks a signed-out visitor to sign in and come back, without calling the API', async () => {
    const { user, calls } = renderPreview({}, { signedIn: false });

    await user.click(await enrolButton());

    const dialog = await screen.findByRole('dialog', {
      name: 'Sign in to enrol',
    });
    expect(
      within(dialog).getByRole('link', { name: 'Continue to sign in' }),
    ).toHaveAttribute('href', `/signin?redirect=${encodeURIComponent('/')}`);
    // The page's public review calls aside, nothing else is called.
    expect(
      calls
        .map(({ path }) => path)
        .filter((path) => !path.startsWith('review.')),
    ).toEqual(['course.publicView']);
  });

  it('enrols a signed-in student who is not enrolled yet', async () => {
    const { user, calls } = renderPreview({
      'course.myEnrolment': () => null,
      'course.enrol': () => enrolment(),
    });

    await user.click(await enrolButton());

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(START));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls).toContainEqual({
      path: 'course.enrol',
      input: { courseId: 'course-1' },
    });

    // The card now offers to start rather than enrol.
    expect(screen.getByText('0% complete')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Start learning' }),
    ).toHaveAttribute('href', '/learn/course-1/home');
    expect(screen.queryByRole('button', { name: 'Enrol now' })).toBeNull();
  });

  it('with continueTo, offers to start that lesson after enrolling', async () => {
    const { user } = renderWithCoreApi(
      <EnrolmentActions
        courseId="course-1"
        courseTitle="Linear Algebra"
        continueTo={{ lessonId: 'lesson-1' }}
      />,
      {
        handlers: {
          'course.myEnrolment': () => null,
          'course.enrol': () => enrolment(),
        },
      },
    );

    await user.click(await enrolButton());

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('link', { name: 'Start this lesson' }),
    ).toHaveAttribute('href', '/learn/course-1/lesson/lesson-1');
    expect(navigate).not.toHaveBeenCalled();
    expect(dialog.querySelector('button svg[class*="arrow"]')).toBeNull();
  });

  it('shows an enrolled student their progress and a way back in', async () => {
    const { calls } = renderPreview({
      'course.myEnrolment': () => enrolment({ progressPercent: 40 }),
    });

    expect(
      await screen.findByRole('link', { name: 'Continue learning' }),
    ).toHaveAttribute('href', '/learn/course-1/home');
    expect(screen.getByText('40% complete')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Course progress' }),
    ).toHaveAttribute('aria-valuenow', '40');
    expect(screen.queryByRole('button', { name: 'Enrol now' })).toBeNull();
    expect(calls.map(({ path }) => path)).not.toContain('course.enrol');
  });

  it('shows when a student completed the course', async () => {
    renderPreview({
      'course.myEnrolment': () =>
        enrolment({
          status: 'completed',
          progressPercent: 100,
          completedAt: '2026-10-10T12:00:00.000Z',
        }),
    });

    expect(
      await screen.findByRole('link', { name: 'Review course' }),
    ).toHaveAttribute('href', '/learn/course-1/home');
    expect(screen.getByText(/Completed on/)).toBeInTheDocument();
  });

  it('tells a student whose enrolment has ended, and lets them enrol again in a free course', async () => {
    let enrolled = false;
    const { user } = renderPreview({
      'course.myEnrolment': () =>
        enrolled ? enrolment() : enrolment({ status: 'dropped' }),
      'course.enrol': () => {
        enrolled = true;
        return enrolment();
      },
    });

    expect(
      await screen.findByText("You're no longer enrolled"),
    ).toBeInTheDocument();
    expect(screen.getByText('Your enrolment has ended.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /learning/ })).toBeNull();

    await user.click(await enrolButton());

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(START));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('explains when the course closed before enrolling', async () => {
    const { user } = renderPreview({
      'course.myEnrolment': () => null,
      'course.enrol': () => {
        throw new ApiError('NOT_FOUND', 'Not found');
      },
    });

    await user.click(await enrolButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This course is no longer open for enrolment.',
    );
    expect(screen.getByRole('button', { name: 'Enrol now' })).toBeEnabled();
  });

  it('shows any other enrolment error as it is', async () => {
    const { user } = renderPreview({
      'course.myEnrolment': () => null,
      'course.enrol': () => {
        throw new ApiError(
          'CONFLICT',
          'Another request was changing the same records; nothing was changed. Please retry',
        );
      },
    });

    await user.click(await enrolButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another request was changing the same records',
    );
  });

  it('still offers to enrol when the enrolment check fails', async () => {
    renderPreview({
      'course.myEnrolment': () => {
        throw new Error('Service unavailable');
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't check your enrolment",
    );
    expect(await enrolButton()).toBeEnabled();
  });

  it('checks the enrolment again when asked to try again', async () => {
    let calls = 0;
    const { user } = renderPreview({
      'course.myEnrolment': () => {
        calls += 1;
        if (calls === 1) throw new Error('Failed to fetch');
        return null;
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Try again in a moment.',
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await vi.waitFor(() => expect(calls).toBe(2));
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

const priced = {
  ...course,
  priceAmount: 2000,
  priceCurrency: 'USD',
  refundWindowDays: 14,
  refundProgressLimitPercent: 50,
};

describe('EnrolmentActions: paid courses', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const renderPriced = (
    handlers: Record<string, Handler> = {},
    options: { signedIn?: boolean; path?: string } = {},
  ) =>
    renderPreview(
      {
        'course.publicView': () => priced,
        'course.myEnrolment': () => null,
        'payment.available': () => ({ available: true }),
        ...handlers,
      },
      options,
    );

  const buyButton = () => screen.findByRole('button', { name: 'Buy now' });

  it('shows Free for a free course', async () => {
    renderPreview({ 'course.myEnrolment': () => null });
    await enrolButton();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in to buy, keeping the course', async () => {
    const { user, calls } = renderPriced({}, { signedIn: false });

    expect(await screen.findByText('$20.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buy now' })).toBeNull();
    await user.click(
      await screen.findByRole('button', { name: 'Sign in to buy' }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Sign in to buy',
    });
    expect(
      within(dialog).getByRole('link', { name: 'Continue to sign in' }),
    ).toHaveAttribute('href', `/signin?redirect=${encodeURIComponent('/')}`);
    expect(calls.map(({ path }) => path)).not.toContain('payment.checkout');
  });

  it('starts a checkout and sends the browser to its page', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { user, calls } = renderPriced({
      'payment.checkout': () => ({ checkoutUrl: 'https://pay.test/session-1' }),
    });

    expect(await screen.findByText('$20.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enrol now' })).toBeNull();
    await user.click(await buyButton());

    expect(
      await screen.findByRole('button', { name: 'Starting payment…' }),
    ).toBeDisabled();
    expect(assign).toHaveBeenCalledWith('https://pay.test/session-1');
    expect(calls).toContainEqual({
      path: 'payment.checkout',
      input: { courseId: 'course-1' },
    });
  });

  it('shows the API message when the checkout fails', async () => {
    const { user } = renderPriced({
      'payment.checkout': () => {
        throw new ApiError('CONFLICT', 'You are already enrolled');
      },
    });

    await user.click(await buyButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You are already enrolled',
    );
    expect(screen.getByRole('button', { name: 'Buy now' })).toBeEnabled();
  });

  it('offers no purchase while payments are unavailable', async () => {
    renderPriced({ 'payment.available': () => ({ available: false }) });

    expect(
      await screen.findByText(
        'Payments are unavailable right now. Please try again later.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buy now' })).toBeNull();
  });

  it('shows the same message when the checkout is refused as unavailable', async () => {
    const { user } = renderPriced({
      'payment.checkout': () => {
        throw new ApiError(
          'PRECONDITION_FAILED',
          'Payments are unavailable right now',
        );
      },
    });

    await user.click(await buyButton());

    expect(
      await screen.findByText(
        'Payments are unavailable right now. Please try again later.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buy now' })).toBeNull();
  });

  it('offers Buy now when enrolling in a course that must be purchased', async () => {
    const { user } = renderPreview({
      'course.myEnrolment': () => null,
      'course.enrol': () => {
        throw new ApiError(
          'PRECONDITION_FAILED',
          'This course must be purchased',
        );
      },
      'payment.available': () => ({ available: true }),
    });

    await user.click(await enrolButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This course must be purchased',
    );
    expect(await buyButton()).toBeEnabled();
  });

  it('shows the cancelled notice with Buy now', async () => {
    renderPriced({}, { path: '/?checkout=cancelled' });

    expect(
      await screen.findByText('Payment cancelled. You have not been charged.'),
    ).toBeInTheDocument();
    expect(await buyButton()).toBeEnabled();
  });

  it('starts a new checkout after an earlier one was cancelled or expired', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { user, calls } = renderPriced(
      {
        'payment.checkout': () => ({
          checkoutUrl: 'https://pay.test/session-2',
        }),
      },
      { path: '/?checkout=cancelled' },
    );

    await user.click(await buyButton());

    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://pay.test/session-2'),
    );
    expect(calls).toContainEqual({
      path: 'payment.checkout',
      input: { courseId: 'course-1' },
    });
  });

  it('offers a dropped student a new purchase', async () => {
    renderPriced({
      'course.myEnrolment': () => enrolment({ status: 'dropped' }),
    });

    expect(await screen.findByText('Your enrolment has ended.')).toBeVisible();
    expect(await buyButton()).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Enrol now' })).toBeNull();
  });

  it('confirms the payment, then shows the enrolled state when the enrolment appears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let enrolled = false;
    renderPriced(
      { 'course.myEnrolment': () => (enrolled ? enrolment() : null) },
      { path: '/?checkout=success' },
    );

    expect(await screen.findByText('Confirming your payment')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Buy now' })).toBeNull();
    expect(screen.queryByRole('link', { name: /learning/ })).toBeNull();

    enrolled = true;
    await act(() => vi.advanceTimersByTimeAsync(2_000));

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ ...START, replace: true }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('goes straight to the lesson when the payment was already confirmed', async () => {
    renderPriced(
      { 'course.myEnrolment': () => enrolment() },
      { path: '/?checkout=success' },
    );

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ ...START, replace: true }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('never navigates on ?checkout=success without an enrolment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPriced({}, { path: '/?checkout=success' });

    await screen.findByText('Confirming your payment');
    await act(() => vi.advanceTimersByTimeAsync(65_000));
    expect(
      await screen.findByText(/Your payment is still being confirmed/),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows an enrolled learner the enrolled card without navigating when the address has no checkout', async () => {
    renderPriced({ 'course.myEnrolment': () => enrolment() });

    expect(
      await screen.findByRole('link', { name: 'Start learning' }),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders no arrow icon in any button', async () => {
    const { container } = renderPriced({
      'course.myEnrolment': () => enrolment(),
    });

    await screen.findByRole('link', { name: 'Start learning' });
    expect(
      container.querySelectorAll(
        'a svg[class*="arrow"], button svg[class*="arrow"]',
      ),
    ).toHaveLength(0);
  });

  it('polls every 2 seconds and gives up after 60', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = renderPriced({}, { path: '/?checkout=success' });
    const enrolmentCalls = () =>
      calls.filter(({ path }) => path === 'course.myEnrolment').length;

    await screen.findByText('Confirming your payment');
    const before = enrolmentCalls();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(enrolmentCalls() - before).toBeGreaterThanOrEqual(4);

    await act(() => vi.advanceTimersByTimeAsync(55_000));
    expect(
      await screen.findByText(
        'Your payment is still being confirmed. It is not lost: refresh in a minute.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Buy now' })).toBeNull();
    expect(screen.queryByRole('link', { name: /learning/ })).toBeNull();

    const after = enrolmentCalls();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(enrolmentCalls()).toBe(after);
  });

  it('has no arrow icons in any button', async () => {
    renderPriced();
    expect((await buyButton()).querySelector('svg')).toBeNull();
  });
});

describe('EnrolmentActions: refunds', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  const TERMS =
    "14-day refund while you've completed less than half of the course. One refund per course.";
  const REFUNDED_BEFORE =
    "You were refunded for this course before. If you buy it again, it can't be refunded.";
  const UNTIL = '2026-11-20T10:00:00.000Z';

  const order = (overrides: Record<string, unknown> = {}) => ({
    status: 'paid',
    amount: 2000,
    currency: 'USD',
    paidAt: '2026-11-06T10:00:00.000Z',
    refundWindowDays: 14,
    refundableUntil: UNTIL,
    canRequestRefund: true,
    ...overrides,
  });

  const renderRefund = (
    handlers: Record<string, Handler> = {},
    options: { signedIn?: boolean; path?: string } = {},
  ) =>
    renderPreview(
      {
        'course.publicView': () => priced,
        'course.myEnrolment': () => enrolment({ paidFor: true }),
        'payment.available': () => ({ available: true }),
        'payment.myOrder': () => order(),
        ...handlers,
      },
      options,
    );

  it('shows the refund terms beside the price of a priced course, signed out', async () => {
    renderRefund({}, { signedIn: false });

    expect(await screen.findByText('$20.00')).toBeInTheDocument();
    expect(screen.getByText(TERMS)).toBeInTheDocument();
  });

  it('shows the refund terms to a signed-in visitor who has not bought', async () => {
    renderRefund({
      'course.myEnrolment': () => null,
      'payment.myOrder': () => null,
    });

    expect(await screen.findByText(TERMS)).toBeInTheDocument();
  });

  it('never shows the refund terms on a free course', async () => {
    renderPreview({ 'course.myEnrolment': () => null });

    await enrolButton();
    expect(screen.queryByText(/refund/i)).toBeNull();
  });

  it('offers a refund until the date, and asks before requesting it', async () => {
    const { user, calls } = renderRefund({
      'payment.requestRefund': () => ({
        refundRequestedAt: '2026-11-10T10:00:00.000Z',
      }),
    });

    expect(
      await screen.findByText(`You can request a refund until ${date(UNTIL)}.`),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request a refund' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('$20.00');
    expect(dialog).toHaveTextContent('access');
    expect(dialog).toHaveTextContent('progress is kept');
    expect(calls.map(({ path }) => path)).not.toContain(
      'payment.requestRefund',
    );

    await user.click(
      within(dialog).getByRole('button', { name: 'Request refund' }),
    );

    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        path: 'payment.requestRefund',
        input: { courseId: 'course-1' },
      }),
    );
    expect(
      await screen.findByText(
        `Refund requested on ${date('2026-11-10T10:00:00.000Z')}. Your access ends when it is confirmed.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Request a refund' }),
    ).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('makes no call when the dialog is cancelled', async () => {
    const { user, calls } = renderRefund();

    await user.click(
      await screen.findByRole('button', { name: 'Request a refund' }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Cancel',
      }),
    );

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.map(({ path }) => path)).not.toContain(
      'payment.requestRefund',
    );
  });

  it('shows an API refusal as an error alert', async () => {
    const { user } = renderRefund({
      'payment.requestRefund': () => {
        throw new ApiError(
          'PRECONDITION_FAILED',
          'The 14-day refund period for this course has ended',
        );
      },
    });

    await user.click(
      await screen.findByRole('button', { name: 'Request a refund' }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Request refund',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The 14-day refund period for this course has ended',
    );
  });

  it('shows a requested refund without a button, and moves to the ended state by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let refunded = false;
    renderRefund({
      'course.myEnrolment': () =>
        enrolment({ status: refunded ? 'dropped' : 'active' }),
      'payment.myOrder': () =>
        refunded
          ? order({
              status: 'refunded',
              canRequestRefund: false,
              refundRequestedAt: '2026-11-10T10:00:00.000Z',
              refundedAt: '2026-11-11T10:00:00.000Z',
            })
          : order({
              canRequestRefund: false,
              refundRequestedAt: '2026-11-10T10:00:00.000Z',
            }),
    });

    expect(
      await screen.findByText(
        `Refund requested on ${date('2026-11-10T10:00:00.000Z')}. Your access ends when it is confirmed.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Request a refund' }),
    ).toBeNull();

    refunded = true;
    await act(() => vi.advanceTimersByTimeAsync(2_000));

    expect(
      await screen.findByText(
        `Your enrolment has ended. Refunded on ${date('2026-11-11T10:00:00.000Z')}.`,
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Buy now' }),
    ).toBeEnabled();
    expect(screen.queryByText(/Refund requested on/)).toBeNull();
  });

  it('stops polling a pending refund after two minutes, and checks again on request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user, calls } = renderRefund({
      'payment.myOrder': () =>
        order({
          canRequestRefund: false,
          refundRequestedAt: '2026-11-10T10:00:00.000Z',
        }),
    });
    await screen.findByText(/Refund requested on/);

    await act(() => vi.advanceTimersByTimeAsync(121_000));
    expect(await screen.findByText(/still being processed/)).toBeVisible();
    const orderCalls = () =>
      calls.filter((call) => call.path === 'payment.myOrder').length;
    const settled = orderCalls();
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(orderCalls()).toBe(settled);

    await user.click(screen.getByRole('button', { name: 'Check again' }));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(orderCalls()).toBeGreaterThan(settled);
    expect(screen.queryByText(/still being processed/)).toBeNull();
  });

  it('tells the student a failed refund failed, and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = renderRefund({
      'payment.myOrder': () =>
        order({
          canRequestRefund: false,
          refundRequestedAt: '2026-11-10T10:00:00.000Z',
          refundFailedAt: '2026-11-10T11:00:00.000Z',
        }),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your refund failed',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('contact support');
    expect(screen.queryByText(/Refund requested on/)).toBeNull();
    const count = () =>
      calls.filter((call) => call.path === 'payment.myOrder').length;
    const settled = count();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(count()).toBe(settled);
  });

  it('says the refund period ended, with no button', async () => {
    renderRefund({
      'payment.myOrder': () =>
        order({ canRequestRefund: false, refundBlockedBy: 'window-ended' }),
    });

    expect(
      await screen.findByText(
        `The refund period for this course ended on ${date(UNTIL)}.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refund/i })).toBeNull();
  });

  it('says a completed course cannot be refunded, with no button', async () => {
    renderRefund({
      'course.myEnrolment': () =>
        enrolment({ status: 'completed', progressPercent: 100 }),
      'payment.myOrder': () =>
        order({ canRequestRefund: false, refundBlockedBy: 'completed' }),
    });

    expect(
      await screen.findByText(
        "A course can't be refunded after you have completed it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refund/i })).toBeNull();
  });

  it('says refunds end at half the course, with no button', async () => {
    renderRefund({
      'course.myEnrolment': () => enrolment({ progressPercent: 50 }),
      'payment.myOrder': () =>
        order({ canRequestRefund: false, refundBlockedBy: 'progress-limit' }),
    });

    expect(
      await screen.findByText(
        "Refunds end once you've completed half of the course.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refund/i })).toBeNull();
  });

  it('says a course refunded before cannot be refunded again, with no button', async () => {
    renderRefund({
      'payment.myOrder': () =>
        order({ canRequestRefund: false, refundBlockedBy: 'refunded-before' }),
    });

    expect(
      await screen.findByText(
        "You were refunded for this course before, so this purchase can't be refunded.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refund/i })).toBeNull();
  });

  it('warns beside Buy now a student who was refunded before', async () => {
    renderRefund({
      'course.myEnrolment': () =>
        enrolment({ status: 'dropped', paidFor: false, refundedBefore: true }),
      'payment.myOrder': () =>
        order({ status: 'refunded', refundedAt: '2026-11-10T10:00:00.000Z' }),
    });

    expect(await screen.findByText(REFUNDED_BEFORE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buy now' })).toBeEnabled();
  });

  it('gives no warning to a student who was not refunded before', async () => {
    renderRefund({
      'course.myEnrolment': () => null,
      'payment.myOrder': () => null,
    });

    await screen.findByRole('button', { name: 'Buy now' });
    expect(screen.queryByText(REFUNDED_BEFORE)).toBeNull();
  });

  it('has no arrow icons in any refund button', async () => {
    renderRefund();
    const button = await screen.findByRole('button', {
      name: 'Request a refund',
    });
    expect(button.querySelector('svg')).toBeNull();
  });

  it("says a purchase from another account can't be refunded here", async () => {
    renderRefund({
      'payment.myOrder': () =>
        order({ canRequestRefund: false, refundBlockedBy: 'other-account' }),
    });

    expect(
      await screen.findByText(
        "This purchase can't be refunded here right now.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /refund/i })).toBeNull();
  });

  it('shows nothing about refunds to a student with no order', async () => {
    renderRefund({ 'payment.myOrder': () => null });

    await screen.findByRole('link', { name: 'Start learning' });
    await vi.waitFor(() => expect(screen.queryByText(/refund/i)).toBeNull());
  });

  it('tells an ended enrolment without a refund only that it ended', async () => {
    renderRefund({
      'course.myEnrolment': () => enrolment({ status: 'dropped' }),
      'payment.myOrder': () => null,
    });

    expect(await screen.findByText('Your enrolment has ended.')).toBeVisible();
    expect(screen.queryByText(/Refunded on/)).toBeNull();
    expect(screen.queryByRole('button', { name: /refund/i })).toBeNull();
  });

  it('renders no arrow icon in any button', async () => {
    const { user } = renderRefund();

    await user.click(
      await screen.findByRole('button', { name: 'Request a refund' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      document.querySelectorAll('button svg[class*="arrow"]'),
    ).toHaveLength(0);
    expect(dialog.querySelector('svg[class*="arrow"]')).toBeNull();
  });
});

describe('EnrolmentActions: leaving a course', () => {
  const leaveButton = () =>
    screen.findByRole('button', { name: 'Leave course' });

  const renderLeave = (
    handlers: Record<string, Handler> = {},
    course_: Record<string, unknown> = course,
  ) =>
    renderPreview({
      'course.publicView': () => course_,
      'payment.available': () => ({ available: true }),
      'payment.myOrder': () => null,
      'course.myEnrolment': () => enrolment({ progressPercent: 40 }),
      ...handlers,
    });

  it('offers Leave course to an enrolled student who did not pay, and confirms first', async () => {
    const { user, calls } = renderLeave({
      'course.unenrol': () => enrolment({ status: 'dropped' }),
    });

    await user.click(await leaveButton());
    const dialog = await screen.findByRole('dialog', { name: 'Leave course' });
    expect(
      within(dialog).getByText(/Your progress is kept/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/now has a price/)).toBeNull();
    expect(calls.map(({ path }) => path)).not.toContain('course.unenrol');

    await user.click(
      within(dialog).getByRole('button', { name: 'Leave course' }),
    );

    expect(await screen.findByText('Your enrolment has ended.')).toBeVisible();
    expect(
      await screen.findByRole('button', { name: 'Enrol now' }),
    ).toBeVisible();
    expect(calls).toContainEqual({
      path: 'course.unenrol',
      input: { courseId: 'course-1' },
    });
    expect(screen.queryByRole('button', { name: 'Leave course' })).toBeNull();
  });

  it('offers it to a completed student too', async () => {
    renderLeave({
      'course.myEnrolment': () =>
        enrolment({ status: 'completed', progressPercent: 100 }),
    });
    expect(await leaveButton()).toBeVisible();
  });

  it('warns that a course which now has a price must be bought to come back, and then offers Buy now', async () => {
    const { user } = renderLeave(
      { 'course.unenrol': () => enrolment({ status: 'dropped' }) },
      { ...course, priceAmount: 2000, priceCurrency: 'USD' },
    );

    await user.click(await leaveButton());
    const dialog = await screen.findByRole('dialog', { name: 'Leave course' });
    expect(
      within(dialog).getByText(/This course now has a price/),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Leave course' }),
    );

    expect(
      await screen.findByRole('button', { name: 'Buy now' }),
    ).toBeVisible();
    expect(screen.getByText('Your enrolment has ended.')).toBeVisible();
  });

  it('makes no call when the dialog is cancelled', async () => {
    const { user, calls } = renderLeave();
    await user.click(await leaveButton());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(calls.map(({ path }) => path)).not.toContain('course.unenrol');
  });

  it('never shows Leave course beside Request a refund', async () => {
    renderLeave(
      {
        'course.myEnrolment': () => enrolment({ paidFor: true }),
        'payment.myOrder': () => ({
          status: 'paid',
          amount: 2000,
          currency: 'USD',
          paidAt: '2026-11-06T10:00:00.000Z',
          refundWindowDays: 14,
          refundableUntil: '2026-11-20T10:00:00.000Z',
          canRequestRefund: true,
        }),
      },
      { ...course, priceAmount: 2000, priceCurrency: 'USD' },
    );
    await screen.findByRole('button', { name: 'Request a refund' });
    expect(screen.queryByRole('button', { name: 'Leave course' })).toBeNull();
  });

  it('shows an API refusal as an error alert', async () => {
    const { user } = renderLeave({
      'course.unenrol': () => {
        throw new ApiError(
          'PRECONDITION_FAILED',
          'You bought this course; request a refund instead',
        );
      },
    });
    await user.click(await leaveButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: 'Leave course' }),
    );
    expect(
      await within(dialog).findByText(
        'You bought this course; request a refund instead',
      ),
    ).toBeVisible();
  });
});

describe('EnrolmentActions: a discount code', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const preview = {
    code: 'SPRING-20',
    listAmount: 2000,
    discountAmount: 400,
    totalAmount: 1600,
    currency: 'USD',
    isFree: false,
  };
  const renderPriced = (handlers: Record<string, Handler> = {}) =>
    renderPreview({
      'course.publicView': () => priced,
      'course.myEnrolment': () => null,
      'payment.available': () => ({ available: true }),
      ...handlers,
    });
  const apply = async (
    user: ReturnType<typeof renderPriced>['user'],
    code = 'spring-20',
  ) => {
    await user.click(
      await screen.findByRole('button', { name: 'Have a code?' }),
    );
    await user.type(screen.getByLabelText('Discount code'), code);
    await user.click(screen.getByRole('button', { name: 'Apply' }));
  };

  it('applying a code shows the summary and the total on the pay button', async () => {
    const { user, calls } = renderPriced({ 'coupon.preview': () => preview });
    await apply(user);

    const summary = await screen.findByLabelText('Price with code');
    expect(within(summary).getByText('List price')).toBeInTheDocument();
    expect(within(summary).getByText('$20.00')).toBeInTheDocument();
    expect(
      within(summary).getByText('Discount (SPRING-20)'),
    ).toBeInTheDocument();
    expect(within(summary).getByText('−$4.00')).toBeInTheDocument();
    expect(within(summary).getByText('$16.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay $16.00' })).toBeEnabled();
    expect(calls).toContainEqual({
      path: 'coupon.preview',
      input: { courseId: 'course-1', code: 'spring-20' },
    });
  });

  it('shows the message of a refused code and leaves the price', async () => {
    const { user } = renderPriced({
      'coupon.preview': () => {
        throw new ApiError('PRECONDITION_FAILED', 'This code has expired');
      },
    });
    await apply(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This code has expired',
    );
    expect(screen.queryByLabelText('Price with code')).toBeNull();
    expect(screen.getByRole('button', { name: 'Buy now' })).toBeEnabled();
    expect(screen.getByText('$20.00')).toBeInTheDocument();
  });

  it('Remove code restores the list price', async () => {
    const { user } = renderPriced({ 'coupon.preview': () => preview });
    await apply(user);
    await user.click(
      await screen.findByRole('button', { name: 'Remove code' }),
    );

    expect(screen.queryByLabelText('Price with code')).toBeNull();
    expect(screen.getByRole('button', { name: 'Buy now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Have a code?' })).toBeVisible();
  });

  it('the pay button passes the code and the browser goes to the checkout', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { user, calls } = renderPriced({
      'coupon.preview': () => preview,
      'payment.checkout': () => ({ checkoutUrl: 'https://pay.test/s-2' }),
    });
    await apply(user);
    await user.click(await screen.findByRole('button', { name: 'Pay $16.00' }));

    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://pay.test/s-2'),
    );
    expect(calls).toContainEqual({
      path: 'payment.checkout',
      input: { courseId: 'course-1', couponCode: 'SPRING-20' },
    });
  });

  it('a late refusal shows its message and clears the code', async () => {
    const { user } = renderPriced({
      'coupon.preview': () => preview,
      'payment.checkout': () => {
        throw new ApiError('PRECONDITION_FAILED', 'This code has expired');
      },
    });
    await apply(user);
    await user.click(await screen.findByRole('button', { name: 'Pay $16.00' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This code has expired',
    );
    expect(screen.queryByLabelText('Price with code')).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Buy now' }),
    ).toBeEnabled();
  });

  it('applying a working code clears the alert of a refused one', async () => {
    let refused = true;
    const { user } = renderPriced({
      'coupon.preview': () => preview,
      'payment.checkout': () => {
        if (refused) {
          throw new ApiError('PRECONDITION_FAILED', 'This code has expired');
        }
        return { checkoutUrl: 'https://pay.test/s-1' };
      },
    });
    await apply(user);
    await user.click(await screen.findByRole('button', { name: 'Pay $16.00' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't start payment",
    );

    refused = false;
    const field = screen.getByLabelText('Discount code');
    await user.clear(field);
    await user.type(field, 'spring-30');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByLabelText('Price with code')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a start without a code sends no couponCode', async () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    const { user, calls } = renderPriced({
      'payment.checkout': () => ({ checkoutUrl: 'https://pay.test/s-1' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Buy now' }));
    await vi.waitFor(() =>
      expect(calls.map(({ path }) => path)).toContain('payment.checkout'),
    );
    expect(
      calls.find(({ path }) => path === 'payment.checkout')?.input,
    ).toEqual({ courseId: 'course-1' });
  });

  describe('a code that makes the course free', () => {
    const freePreview = {
      ...preview,
      code: 'FREE',
      discountAmount: 2000,
      totalAmount: 0,
      isFree: true,
    };

    it('changes the button to Enrol for free and says no payment is needed', async () => {
      const { user } = renderPriced({ 'coupon.preview': () => freePreview });
      await apply(user, 'free');

      expect(
        await screen.findByRole('button', { name: 'Enrol for free' }),
      ).toBeEnabled();
      expect(screen.getByText('No payment is needed.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Pay/ })).toBeNull();
    });

    it('starts the checkout with the code and enrols without a payment redirect', async () => {
      const assign = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign });
      const { user, calls } = renderPriced({
        'coupon.preview': () => freePreview,
        'payment.checkout': () => ({ enrolled: true }),
      });
      await apply(user, 'free');
      await user.click(
        await screen.findByRole('button', { name: 'Enrol for free' }),
      );

      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(START));
      expect(assign).not.toHaveBeenCalled();
      expect(calls).toContainEqual({
        path: 'payment.checkout',
        input: { courseId: 'course-1', couponCode: 'FREE' },
      });
    });

    it('shows the message of a refusal and goes back to the list price', async () => {
      const { user } = renderPriced({
        'coupon.preview': () => freePreview,
        'payment.checkout': () => {
          throw new ApiError(
            'PRECONDITION_FAILED',
            'This code has been used the maximum number of times',
          );
        },
      });
      await apply(user, 'free');
      await user.click(
        await screen.findByRole('button', { name: 'Enrol for free' }),
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This code has been used the maximum number of times',
      );
      expect(
        await screen.findByRole('button', { name: 'Buy now' }),
      ).toBeEnabled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('words a failure for enrolling, not paying', async () => {
      const { user } = renderPriced({
        'coupon.preview': () => freePreview,
        'payment.checkout': () => {
          throw new ApiError('PRECONDITION_FAILED', 'This code has expired');
        },
      });
      await apply(user, 'free');
      await user.click(
        await screen.findByRole('button', { name: 'Enrol for free' }),
      );

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent("Couldn't enrol you");
      expect(alert).not.toHaveTextContent(/payment/i);
    });
  });

  it('shows no code field for a course without a price', async () => {
    renderPreview({ 'course.myEnrolment': () => null });
    await enrolButton();
    expect(screen.queryByRole('button', { name: 'Have a code?' })).toBeNull();
  });
});
