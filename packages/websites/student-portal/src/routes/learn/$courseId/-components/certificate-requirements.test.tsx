/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  renderWithCoreApi,
} from '../../../../test/render-with-core-api';
import { CertificateRequirements } from './certificate-requirements';

const complete = (done: number, total: number) => ({
  kind: 'complete-items',
  met: done === total,
  done,
  total,
});

const quizzes = (states: string[]) => {
  const items = states.map((state, i) => ({
    contentItemId: `q${i}`,
    lessonId: `lesson-${i}`,
    title: `Quiz ${i}`,
    state,
  }));
  const done = items.filter((i) => i.state === 'passed').length;
  return {
    kind: 'pass-quizzes',
    met: done === items.length,
    done,
    total: items.length,
    items,
  };
};

const answer = (over: Record<string, unknown> = {}) => ({
  certificatesEnabled: true,
  certificate: null,
  allMet: false,
  requirements: [complete(12, 14)],
  ...over,
});

const render = (handler: (input: any) => unknown) =>
  renderWithCoreApi(
    <CertificateRequirements
      courseId="course-1"
      courseTitle="Intro"
      completedAt="2026-11-10T00:00:00.000Z"
    />,
    { handlers: { 'certificate.requirements': handler } },
  );

describe('CertificateRequirements', () => {
  it('shows nothing when certificates are off', async () => {
    const { calls } = render(() =>
      answer({ certificatesEnabled: false, requirements: [] }),
    );

    await vi_waitForCall(calls);
    expect(
      screen.queryByRole('heading', { name: 'Certificate' }),
    ).not.toBeInTheDocument();
  });

  it('shows a skeleton while loading', async () => {
    render(() => new Promise(() => {}));

    expect(
      await screen.findByRole('heading', { name: 'Certificate' }),
    ).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('asks for the course and lists each requirement with its count', async () => {
    const { calls } = render(() =>
      answer({
        requirements: [complete(12, 14), quizzes(['passed', 'not-passed'])],
      }),
    );

    expect(
      await screen.findByText('Complete every item: 12 of 14'),
    ).toBeInTheDocument();
    expect(screen.getByText('Pass every quiz: 1 of 2')).toBeInTheDocument();
    expect(calls[0]?.input).toEqual({ courseId: 'course-1' });
  });

  it('lists each unmet quiz as a link with its state, and not the passed ones', async () => {
    render(() =>
      answer({
        requirements: [
          complete(1, 1),
          quizzes([
            'passed',
            'not-attempted',
            'not-passed',
            'no-attempts-left',
          ]),
        ],
      }),
    );

    const link = await screen.findByRole('link', { name: 'Quiz 1' });
    expect(link).toHaveAttribute('href', '/learn/course-1/lesson/lesson-1');
    expect(screen.getByText(/Not attempted/)).toBeInTheDocument();
    expect(screen.getByText(/Not passed yet/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Not passed, no attempts left\. Ask your instructor for another attempt\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Quiz 0' }),
    ).not.toBeInTheDocument();
  });

  it('says the certificate is being prepared once everything is met', async () => {
    render(() => answer({ allMet: true, requirements: [complete(2, 2)] }));

    expect(
      await screen.findByText('Your certificate is being prepared.'),
    ).toBeInTheDocument();
  });

  it('shows the certificate with its actions once issued', async () => {
    render(() =>
      answer({
        allMet: true,
        requirements: [complete(2, 2)],
        certificate: { certificateId: 'ABCD-EFGH', status: 'valid' },
      }),
    );

    expect(
      await screen.findByText('You earned a certificate'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      '/certificates/ABCD-EFGH',
    );
    expect(
      screen.getByRole('button', { name: 'Download PDF' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy link' }),
    ).toBeInTheDocument();
  });

  it('looks again once the course home sees the course completed', async () => {
    // As the course home: completedAt arrives when progress recalculation
    // lands, after the requirements were first fetched.
    const Harness = () => {
      const [completedAt, setCompletedAt] = useState<string>();
      return (
        <>
          <button
            type="button"
            onClick={() => setCompletedAt('2026-11-10T00:00:00.000Z')}
          >
            Recalculated
          </button>
          <CertificateRequirements
            courseId="course-1"
            courseTitle="Intro"
            completedAt={completedAt}
          />
        </>
      );
    };
    let recalculated = false;
    const { user } = renderWithCoreApi(<Harness />, {
      handlers: {
        'certificate.requirements': () =>
          recalculated
            ? answer({
                allMet: true,
                requirements: [complete(2, 2)],
                certificate: { certificateId: 'ABCD-EFGH', status: 'valid' },
              })
            : answer({
                requirements: [{ ...complete(2, 2), met: false }],
              }),
      },
    });

    expect(
      await screen.findByText('Complete every item: 2 of 2'),
    ).toBeInTheDocument();
    recalculated = true;
    await user.click(screen.getByRole('button', { name: 'Recalculated' }));
    expect(
      await screen.findByText('You earned a certificate'),
    ).toBeInTheDocument();
  });

  it('shows a retryable error', async () => {
    let fail = true;
    render(() => {
      if (fail) {
        throw new ApiError('PRECONDITION_FAILED', 'Something broke');
      }
      return answer();
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something broke',
    );
    fail = false;
    const user = (await import('@testing-library/user-event')).default.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('Complete every item: 12 of 14'),
    ).toBeInTheDocument();
  });
});

// Waits until the query has been answered, so "nothing shown" is checked
// after the data arrived rather than before.
async function vi_waitForCall(calls: unknown[]) {
  await import('@testing-library/react').then(({ waitFor }) =>
    waitFor(() => expect(calls.length).toBeGreaterThan(0)),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
}
