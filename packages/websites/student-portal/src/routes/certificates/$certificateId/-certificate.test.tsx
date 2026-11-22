/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveBrand } from '@discava/common-branding/brand';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from '../../../routeTree.gen';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../../test/render-with-core-api';

const certificate = {
  status: 'valid',
  statement: [
    'Completed all 14 items of the course.',
    'Passed 3 assessed quizzes. Pass mark: 70%.',
    'Overall score: 80–89%.',
  ],
  certificateId: 'ABCD-EFGH-JKLM',
  learnerName: 'Ada Lovelace',
  courseTitle: 'Linear Algebra',
  completedAt: '2026-10-05T12:00:00.000Z',
  completedOn: '5 October 2026',
};

const open = (
  handler: (input: unknown) => unknown,
  path = '/certificates/ABCD-EFGH-JKLM',
  {
    signedIn = false,
    handlers = {},
    brand,
  }: {
    signedIn?: boolean;
    handlers?: Record<string, Handler>;
    brand?: ReturnType<typeof resolveBrand>;
  } = {},
) =>
  renderWithCoreApi(null, {
    routeTree,
    path,
    signedIn,
    brand,
    handlers: { 'certificate.verify': handler, ...handlers },
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

  it('lists what the certificate confirms, in order', async () => {
    open(() => certificate);

    expect(
      await screen.findByRole('heading', {
        name: 'What this certificate confirms',
      }),
    ).toBeInTheDocument();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(certificate.statement);
  });

  it('shows only the ID and date for a revoked certificate', async () => {
    open(() => ({
      status: 'revoked',
      certificateId: 'ABCD-EFGH-JKLM',
      revokedAt: '2026-11-12T08:00:00.000Z',
      revokedOn: '12 November 2026',
    }));

    expect(
      await screen.findByRole('heading', { name: 'Certificate revoked' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'This certificate has been revoked and is no longer valid.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/ABCD-EFGH-JKLM/)).toBeInTheDocument();
    expect(screen.getByText('Revoked on 12 November 2026')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('Ada Lovelace');
    expect(document.body).not.toHaveTextContent('Linear Algebra');
    expect(
      screen.queryByRole('heading', { name: 'What this certificate confirms' }),
    ).not.toBeInTheDocument();
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

describe('/certificates/<ID> for the owner', () => {
  const mine = (certificateId = 'ABCD-EFGH-JKLM') => ({
    'certificate.myCertificates': () => [
      {
        certificateId,
        courseId: 'c1',
        courseTitle: 'Linear Algebra',
        learnerName: 'Ada Lovelace',
        completedAt: certificate.completedAt,
      },
    ],
    'certificate.recordLinkedInClick': () => ({}),
  });

  it('shows the owner the LinkedIn section and its five values', async () => {
    open(() => certificate, undefined, { signedIn: true, handlers: mine() });

    expect(
      await screen.findByRole('heading', {
        name: 'Add this certificate to your LinkedIn profile',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Add to LinkedIn profile' }),
    ).toBeInTheDocument();
    expect(screen.getByText('What LinkedIn asks for')).toBeInTheDocument();
    for (const label of [
      'Name',
      'Issuing organisation',
      'Issue date',
      'Credential ID',
      'Credential URL',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('October 2026')).toBeInTheDocument();
    expect(
      screen.getByText(
        /We can't see your LinkedIn profile, so this button stays here/,
      ),
    ).toBeInTheDocument();
    // What the page showed before is still there.
    expect(screen.getByText('Certificate of completion')).toBeInTheDocument();
    expect(screen.getByText('5 October 2026')).toBeInTheDocument();
  });

  it('names the brand as the issuing organisation', async () => {
    const brand = resolveBrand(
      {
        name: 'Acme Academy',
        showNameBesideLogo: true,
        colour: null,
        logoKey: null,
        iconKey: null,
        shareImageKey: null,
      },
      undefined,
    );
    open(() => certificate, undefined, {
      signedIn: true,
      handlers: mine(),
      brand,
    });

    const link = await screen.findByRole('link', {
      name: 'Add to LinkedIn profile',
    });
    expect(link.getAttribute('href')).toContain(
      'organizationName=Acme+Academy',
    );
    const issuer = screen.getByText('Issuing organisation');
    expect(issuer.parentElement).toHaveTextContent('Acme Academy');
  });

  it('does not show it to another signed-in user', async () => {
    open(() => certificate, undefined, {
      signedIn: true,
      handlers: mine('ZZZZ-ZZZZ-ZZZZ'),
    });

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Add to LinkedIn profile')).toBeNull(),
    );
    expect(screen.queryByText('What LinkedIn asks for')).toBeNull();
  });

  it('does not show it, or ask for certificates, when signed out', async () => {
    const { calls } = open(() => certificate);

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('What LinkedIn asks for')).toBeNull();
    expect(calls.map((c) => c.path)).not.toContain(
      'certificate.myCertificates',
    );
  });

  it('records a click with the certificate page as the source', async () => {
    const { user, calls } = open(() => certificate, undefined, {
      signedIn: true,
      handlers: mine(),
    });
    const link = await screen.findByRole('link', {
      name: 'Add to LinkedIn profile',
    });
    link.addEventListener('click', (event) => event.preventDefault());

    await user.click(link);

    await waitFor(() =>
      expect(calls).toContainEqual({
        path: 'certificate.recordLinkedInClick',
        input: { certificateId: 'ABCD-EFGH-JKLM', source: 'certificate-page' },
      }),
    );
  });
});
