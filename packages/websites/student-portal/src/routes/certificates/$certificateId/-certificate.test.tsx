/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../../../routeTree.gen';
import {
  ApiError,
  renderWithCoreApi,
} from '../../../test/render-with-core-api';

const certificate = {
  certificateId: 'ABCD-EFGH-JKLM',
  learnerName: 'Ada Lovelace',
  courseTitle: 'Linear Algebra',
  completedAt: '2026-10-05T12:00:00.000Z',
  completedOn: '5 October 2026',
};

const open = (
  handler: (input: unknown) => unknown,
  path = '/certificates/ABCD-EFGH-JKLM',
) =>
  renderWithCoreApi(null, {
    routeTree,
    path,
    signedIn: false,
    handlers: { 'certificate.verify': handler },
  });

describe('/certificates/<ID>', () => {
  it('shows the certificate to a signed-out visitor', async () => {
    const { router, calls } = open(() => certificate);

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Certificate of completion')).toBeInTheDocument();
    expect(screen.getByText('Linear Algebra')).toBeInTheDocument();
    expect(screen.getByText('5 October 2026')).toBeInTheDocument();
    expect(screen.getByText(/ABCD-EFGH-JKLM/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/certificates/ABCD-EFGH-JKLM');
    expect(calls).toContainEqual({
      path: 'certificate.verify',
      input: { certificateId: 'ABCD-EFGH-JKLM' },
    });
  });

  it('shows the API’s date, not one formatted for the viewer', async () => {
    // 20 November in Sydney, still 19 November in UTC.
    open(() => ({
      ...certificate,
      completedAt: '2026-11-19T19:48:06.000Z',
      completedOn: '19 November 2026',
    }));

    expect(await screen.findByText('19 November 2026')).toBeInTheDocument();
    expect(screen.queryByText('20 November 2026')).toBeNull();
  });

  it('passes a lowercase, dash-less ID as typed', async () => {
    const { calls } = open(() => certificate, '/certificates/abcdefghjklm');

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(calls[0]?.input).toEqual({ certificateId: 'abcdefghjklm' });
  });

  it('shows no learner data while loading', async () => {
    open(() => new Promise(() => {}));

    expect(
      await screen.findByTestId('certificate-loading'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
    expect(screen.queryByText('Certificate of completion')).toBeNull();
  });

  it('says so when the certificate is not found', async () => {
    open(() => {
      throw new ApiError('NOT_FOUND', 'Certificate not found');
    });

    expect(
      await screen.findByRole('heading', { name: 'Certificate not found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the home page' }),
    ).toHaveAttribute('href', '/');
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });

  it('offers a retry when the lookup fails', async () => {
    let fail = true;
    const { user } = open(() => {
      if (fail) {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'boom');
      }
      return certificate;
    });

    expect(
      await screen.findByText("Couldn't check this certificate"),
    ).toBeInTheDocument();
    expect(screen.queryByText('Certificate not found')).toBeNull();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('shows nothing but the certificate’s four details', async () => {
    const { container } = open(() => ({
      ...certificate,
      email: 'ada@example.com',
      userId: 'user-123',
    }));

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    await waitFor(() => expect(container.textContent).not.toContain('@'));
    expect(container.textContent).not.toContain('user-123');
  });
});
