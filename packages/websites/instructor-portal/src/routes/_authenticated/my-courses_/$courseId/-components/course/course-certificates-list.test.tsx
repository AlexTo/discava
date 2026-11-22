/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { CourseCertificatesList } from './course-certificates-list';

const COURSE_ID = 'course-1';

const valid = {
  certificateId: 'AAAA-BBBB-CCCC',
  learnerName: 'Sam Learner',
  completedAt: '2026-11-10T10:00:00.000Z',
  issuedAt: '2026-11-10T10:00:00.000Z',
  status: 'valid',
  canRestore: false,
};
const revoked = {
  certificateId: 'DDDD-EEEE-FFFF',
  learnerName: 'Bo Learner',
  completedAt: '2026-11-09T10:00:00.000Z',
  issuedAt: '2026-11-09T10:00:00.000Z',
  status: 'revoked',
  revokedAt: '2026-11-12T10:00:00.000Z',
  revocationReason: 'academic-integrity',
  revokedByRole: 'instructor',
  canRestore: true,
};
const adminRevoked = {
  ...revoked,
  certificateId: 'GGGG-HHHH-IIII',
  learnerName: 'Al Learner',
  revocationReason: 'refunded',
  revokedByRole: 'admin',
  canRestore: false,
};

const render = (handlers: Record<string, Handler> = {}) =>
  renderWithInstructorApi(<CourseCertificatesList courseId={COURSE_ID} />, {
    handlers: {
      'certificate.list': () => ({ items: [valid, revoked, adminRevoked] }),
      ...handlers,
    },
  });

const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

describe('CourseCertificatesList', () => {
  it('shows the table with statuses', async () => {
    render();

    await screen.findByText('Sam Learner');
    expect(within(rowOf('Sam Learner')).getByText('Valid')).toBeInTheDocument();
    expect(
      within(rowOf('Bo Learner')).getByText(
        /Revoked on .*: Academic integrity/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('AAAA-BBBB-CCCC')).toBeInTheDocument();
  });

  it('says when there are none', async () => {
    render({ 'certificate.list': () => ({ items: [] }) });

    expect(await screen.findByText('No certificates yet')).toBeInTheDocument();
  });

  it('loads the next page', async () => {
    const { calls, user } = render({
      'certificate.list': (input: { cursor?: string }) =>
        input.cursor
          ? { items: [adminRevoked] }
          : { items: [valid], nextCursor: 'next' },
    });

    await user.click(await screen.findByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Al Learner')).toBeInTheDocument();
    expect(calls).toContainEqual({
      path: 'certificate.list',
      input: expect.objectContaining({ courseId: COURSE_ID, cursor: 'next' }),
    });
  });

  it('revokes with a reason, without Order refunded', async () => {
    const { calls, user } = render({ 'certificate.revoke': () => revoked });

    await user.click(
      await screen.findByRole('button', {
        name: "Revoke Sam Learner's certificate",
      }),
    );
    expect(
      screen.getByText(
        'The public page will say this certificate has been revoked, and the student will be told.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Order refunded' }),
    ).not.toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText('Reason'),
      'issued-in-error',
    );
    await user.click(
      screen.getByRole('button', { name: 'Revoke certificate' }),
    );

    await waitFor(() =>
      expect(calls).toContainEqual({
        path: 'certificate.revoke',
        input: {
          courseId: COURSE_ID,
          certificateId: 'AAAA-BBBB-CCCC',
          reason: 'issued-in-error',
        },
      }),
    );
  });

  it('needs a note for Other and limits it to 500 characters', async () => {
    const { calls, user } = render({ 'certificate.revoke': () => revoked });

    await user.click(
      await screen.findByRole('button', {
        name: "Revoke Sam Learner's certificate",
      }),
    );
    await user.selectOptions(screen.getByLabelText('Reason'), 'other');
    const submit = screen.getByRole('button', { name: 'Revoke certificate' });
    expect(submit).toBeDisabled();
    expect(screen.getByLabelText('Note')).toHaveAttribute('maxlength', '500');
    await user.type(screen.getByLabelText('Note'), 'Shared answers');
    await user.click(submit);

    await waitFor(() =>
      expect(calls).toContainEqual({
        path: 'certificate.revoke',
        input: {
          courseId: COURSE_ID,
          certificateId: 'AAAA-BBBB-CCCC',
          reason: 'other',
          note: 'Shared answers',
        },
      }),
    );
  });

  it('cancels without calling the API', async () => {
    const { calls, user } = render();

    await user.click(
      await screen.findByRole('button', {
        name: "Revoke Sam Learner's certificate",
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(calls.filter((c) => c.path === 'certificate.revoke')).toEqual([]);
  });

  it('shows a failure in the dialog and leaves the row', async () => {
    const { user } = render({
      'certificate.revoke': () => {
        throw new ApiError('FORBIDDEN', 'Not allowed');
      },
    });

    await user.click(
      await screen.findByRole('button', {
        name: "Revoke Sam Learner's certificate",
      }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Revoke certificate' }),
    );

    expect(
      await screen.findByText("Couldn't revoke the certificate"),
    ).toBeInTheDocument();
    expect(within(rowOf('Sam Learner')).getByText('Valid')).toBeInTheDocument();
  });

  it('restores after confirmation', async () => {
    const { calls, user } = render({ 'certificate.restore': () => valid });

    await user.click(
      await screen.findByRole('button', {
        name: "Restore Bo Learner's certificate",
      }),
    );
    expect(calls.filter((c) => c.path === 'certificate.restore')).toEqual([]);
    await user.click(
      screen.getByRole('button', { name: 'Restore certificate' }),
    );

    await waitFor(() =>
      expect(calls).toContainEqual({
        path: 'certificate.restore',
        input: { courseId: COURSE_ID, certificateId: 'DDDD-EEEE-FFFF' },
      }),
    );
  });

  it('offers no Restore when an administrator revoked it', async () => {
    render();

    await screen.findByText('Al Learner');
    expect(
      within(rowOf('Al Learner')).getByText('Revoked by an administrator'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: "Restore Al Learner's certificate",
      }),
    ).not.toBeInTheDocument();
  });

  it("opens a row's history", async () => {
    const { calls, user } = render({
      'certificate.history': () => [
        {
          type: 'revoked',
          occurredAt: '2026-11-12T10:00:00.000Z',
          reason: 'other',
          note: 'Copied work',
          actorRole: 'instructor',
          actorName: 'Ines Instructor',
        },
      ],
    });

    await user.click(
      await screen.findByRole('button', {
        name: 'Show history for Bo Learner',
      }),
    );

    expect(await screen.findByText(/by Ines Instructor/)).toHaveTextContent(
      'Note: Copied work',
    );
    expect(calls).toContainEqual({
      path: 'certificate.history',
      input: { courseId: COURSE_ID, certificateId: 'DDDD-EEEE-FFFF' },
    });
  });
});
