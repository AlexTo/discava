/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../../../routeTree.gen';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../../test/render-with-core-api';

const certificate = {
  status: 'valid',
  statement: ['Completed all 3 items of the course.'],
  certificateId: 'ABCD-EFGH-JKLM-NPQR',
  learnerName: 'Ada Lovelace',
  courseTitle: 'Linear Algebra',
  completedAt: '2026-10-05T12:00:00.000Z',
  completedOn: '5 October 2026',
};

const LINKEDIN =
  /^https:\/\/www\.linkedin\.com\/profile\/add\?startTask=CERTIFICATION_NAME/;

const replace = vi.fn();
const realLocation = window.location;
beforeEach(() => {
  replace.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'https://learn.example.com', replace },
  });
});
afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: realLocation,
  });
  vi.useRealTimers();
});

const open = (path: string, handlers: Record<string, Handler> = {}) =>
  renderWithCoreApi(null, {
    routeTree,
    path,
    signedIn: false,
    handlers: { 'certificate.verify': () => certificate, ...handlers },
  });

describe('/certificates/<ID>/linkedin', () => {
  it('records with the source from the address, then replaces the location with LinkedIn', async () => {
    const { calls } = open(
      '/certificates/ABCD-EFGH-JKLM-NPQR/linkedin?source=reminder-email',
      { 'certificate.recordLinkedInClick': () => ({}) },
    );

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace.mock.calls[0]?.[0]).toMatch(LINKEDIN);
    expect(replace.mock.calls[0]?.[0]).toContain('certId=ABCD-EFGH-JKLM-NPQR');
    expect(replace.mock.calls[0]?.[0]).toContain(
      encodeURIComponent(
        'https://learn.example.com/certificates/ABCD-EFGH-JKLM-NPQR',
      ),
    );
    expect(calls).toContainEqual({
      path: 'certificate.recordLinkedInClick',
      input: { certificateId: 'ABCD-EFGH-JKLM-NPQR', source: 'reminder-email' },
    });
  });

  it('reads any other source as issued-email', async () => {
    const { calls } = open(
      '/certificates/ABCD-EFGH-JKLM-NPQR/linkedin?source=whatever',
      { 'certificate.recordLinkedInClick': () => ({}) },
    );

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(
      calls.find((c) => c.path === 'certificate.recordLinkedInClick')?.input,
    ).toMatchObject({ source: 'issued-email' });
  });

  it('shows "Opening LinkedIn…" with a link to the same address', async () => {
    open('/certificates/ABCD-EFGH-JKLM-NPQR/linkedin', {
      'certificate.recordLinkedInClick': () => new Promise(() => {}),
    });

    expect(
      await screen.findByRole('heading', { name: 'Opening LinkedIn…' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('link', { name: 'Continue to LinkedIn' }),
    ).toHaveAttribute('href', expect.stringMatching(LINKEDIN));
  });

  it('still redirects when recording fails', async () => {
    open('/certificates/ABCD-EFGH-JKLM-NPQR/linkedin', {
      'certificate.recordLinkedInClick': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'boom');
      },
    });

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace.mock.calls[0]?.[0]).toMatch(LINKEDIN);
  });

  it('still redirects after 2 seconds when recording is slow', async () => {
    open('/certificates/ABCD-EFGH-JKLM-NPQR/linkedin', {
      'certificate.recordLinkedInClick': () => new Promise(() => {}),
    });

    await screen.findByRole('link', { name: 'Continue to LinkedIn' });
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1), {
      timeout: 4000,
    });
  });

  it('says so, and does not redirect, for an unknown certificate', async () => {
    open('/certificates/ZZZZ-ZZZZ-ZZZZ-ZZZZ/linkedin', {
      'certificate.verify': () => {
        throw new ApiError('NOT_FOUND', 'Certificate not found');
      },
    });

    expect(
      await screen.findByRole('heading', { name: 'Certificate not found' }),
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('asks LinkedIn not to be told the referrer while mounted', async () => {
    const { unmount } = open('/certificates/ABCD-EFGH-JKLM-NPQR/linkedin', {
      'certificate.recordLinkedInClick': () => ({}),
    });

    await waitFor(() =>
      expect(
        document.head.querySelector('meta[name="referrer"]'),
      ).toHaveAttribute('content', 'no-referrer'),
    );
    unmount();
    expect(document.head.querySelector('meta[name="referrer"]')).toBeNull();
  });
});
