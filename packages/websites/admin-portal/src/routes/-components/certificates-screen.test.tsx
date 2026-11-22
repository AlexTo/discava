/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithAdminApi,
} from '../../test/render-with-admin-api';
import { CertificatesScreen } from './certificates-screen';

const valid = {
  certificateId: 'AAAA-BBBB-CCCC',
  learnerName: 'Sam Learner',
  courseId: 'c1',
  courseTitle: 'Physics',
  completedAt: '2026-11-10T10:00:00.000Z',
  issuedAt: '2026-11-10T10:00:00.000Z',
  statement: ['Completed every item.'],
  status: 'valid',
  history: [],
};
const revoked = {
  ...valid,
  status: 'revoked',
  revokedAt: '2026-11-12T10:00:00.000Z',
  revocationReason: 'refunded',
  revokedByRole: 'admin',
  history: [
    {
      type: 'revoked',
      occurredAt: '2026-11-12T10:00:00.000Z',
      reason: 'refunded',
      note: 'Chargeback',
      actorRole: 'admin',
      actorName: 'An administrator',
    },
  ],
};

const render = (handlers: Record<string, Handler> = {}) =>
  renderWithAdminApi(<CertificatesScreen />, {
    handlers: { 'certificate.get': () => valid, ...handlers },
  });

const lookUp = async (rendered: ReturnType<typeof render>) => {
  await rendered.user.type(
    screen.getByLabelText('Certificate ID'),
    'AAAA-BBBB-CCCC',
  );
  await rendered.user.click(screen.getByRole('button', { name: 'Look up' }));
};

describe('the Certificates screen', () => {
  it('finds a certificate by ID', async () => {
    const rendered = render();
    await lookUp(rendered);

    expect(await screen.findByText('Sam Learner')).toBeInTheDocument();
    expect(screen.getByText(/Physics/)).toBeInTheDocument();
    expect(screen.getByText('Completed every item.')).toBeInTheDocument();
    expect(rendered.calls).toContainEqual({
      path: 'certificate.get',
      input: { certificateId: 'AAAA-BBBB-CCCC' },
    });
  });

  it('says when it is not found', async () => {
    const rendered = render({
      'certificate.get': () => {
        throw new ApiError('NOT_FOUND', 'nope');
      },
    });
    await lookUp(rendered);

    expect(
      await screen.findByText('Certificate not found'),
    ).toBeInTheDocument();
  });

  it('revokes with Order refunded', async () => {
    const rendered = render({ 'certificate.revoke': () => revoked });
    await lookUp(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Revoke' }),
    );
    await rendered.user.selectOptions(
      screen.getByLabelText('Reason'),
      'refunded',
    );
    await rendered.user.click(
      screen.getByRole('button', { name: 'Revoke certificate' }),
    );

    await waitFor(() =>
      expect(rendered.calls).toContainEqual({
        path: 'certificate.revoke',
        input: { certificateId: 'AAAA-BBBB-CCCC', reason: 'refunded' },
      }),
    );
  });

  it('needs a note for Other', async () => {
    const rendered = render();
    await lookUp(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Revoke' }),
    );
    await rendered.user.selectOptions(screen.getByLabelText('Reason'), 'other');

    expect(
      screen.getByRole('button', { name: 'Revoke certificate' }),
    ).toBeDisabled();
    await rendered.user.type(screen.getByLabelText('Note'), 'Why');
    expect(
      screen.getByRole('button', { name: 'Revoke certificate' }),
    ).toBeEnabled();
  });

  it('restores a revoked certificate', async () => {
    const rendered = render({
      'certificate.get': () => revoked,
      'certificate.restore': () => valid,
    });
    await lookUp(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Restore' }),
    );
    await rendered.user.click(
      screen.getByRole('button', { name: 'Restore certificate' }),
    );

    await waitFor(() =>
      expect(rendered.calls).toContainEqual({
        path: 'certificate.restore',
        input: { certificateId: 'AAAA-BBBB-CCCC' },
      }),
    );
  });

  it('shows the history with notes', async () => {
    const rendered = render({ 'certificate.get': () => revoked });
    await lookUp(rendered);

    expect(
      await screen.findByText(/by An administrator.*Note: Chargeback/),
    ).toBeInTheDocument();
  });
});
