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

const priced = { ...course, priceAmount: 2000, priceCurrency: 'USD' };

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
