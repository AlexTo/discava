/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { RouterProvider } from '@tanstack/react-router';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type Handler,
  renderWithAdminApi,
} from '../../test/render-with-admin-api';
import { routerFor } from '../../test/router-for';
import { certificatesSearch } from '../-search';
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

const render = async (
  handlers: Record<string, Handler> = {},
  entry = '/certificates',
) => {
  const router = routerFor(
    '/certificates',
    {
      component: CertificatesScreen,
      validateSearch: certificatesSearch,
    },
    entry,
  );
  await router.load();
  const rendered = renderWithAdminApi(<RouterProvider router={router} />, {
    handlers: { 'certificate.get': () => valid, ...handlers },
  });
  return { ...rendered, router };
};

const lookUp = async (rendered: Awaited<ReturnType<typeof render>>) => {
  await rendered.user.type(
    screen.getByLabelText('Certificate ID'),
    'AAAA-BBBB-CCCC',
  );
  await rendered.user.click(screen.getByRole('button', { name: 'Look up' }));
};

describe('the Certificates screen', () => {
  it('finds a certificate by ID', async () => {
    const rendered = await render();
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
    const rendered = await render({
      'certificate.get': () => {
        throw new ApiError('NOT_FOUND', 'nope');
      },
    });
    await lookUp(rendered);

    const status = (await screen.findByText('No certificate has this ID'))
      .parentElement!;
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent(
      "Check the ID against the certificate's page or PDF. IDs look like 7V0Y-TKB5-6T6K-RPB3.",
    );
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('offers Try again when the lookup fails', async () => {
    let fail = true;
    const rendered = await render({
      'certificate.get': () => {
        if (fail) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'Down');
        }
        return valid;
      },
    });
    await lookUp(rendered);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't look up the certificate",
    );
    fail = false;
    await rendered.user.click(
      screen.getByRole('button', { name: 'Try again' }),
    );
    expect(await screen.findByText('Sam Learner')).toBeInTheDocument();
  });

  it('checks an empty ID on submit, focuses the field and sends nothing', async () => {
    const rendered = await render();
    const lookUpButton = screen.getByRole('button', { name: 'Look up' });
    expect(lookUpButton).toBeEnabled();
    await rendered.user.click(lookUpButton);

    const field = screen.getByLabelText('Certificate ID');
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Enter a certificate ID.');
    expect(rendered.calls.some((c) => c.path === 'certificate.get')).toBe(
      false,
    );
  });

  it('revokes with Order refunded', async () => {
    const rendered = await render({ 'certificate.revoke': () => revoked });
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

  it('checks for a note on submit when the reason is Other', async () => {
    const rendered = await render();
    await lookUp(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Revoke' }),
    );
    await rendered.user.selectOptions(screen.getByLabelText('Reason'), 'other');

    const submit = screen.getByRole('button', { name: 'Revoke certificate' });
    expect(submit).toBeEnabled();
    await rendered.user.click(submit);

    const note = screen.getByLabelText('Note');
    expect(note).toHaveFocus();
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(note).toHaveAccessibleDescription(/Enter a note to say why\./);
    expect(rendered.calls.some((c) => c.path === 'certificate.revoke')).toBe(
      false,
    );
  });

  it('restores a revoked certificate', async () => {
    const rendered = await render({
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
    const rendered = await render({ 'certificate.get': () => revoked });
    await lookUp(rendered);

    const note = await screen.findByText('Note: Chargeback');
    expect(note).toHaveClass('block', 'break-words');
    expect(note.parentElement).toHaveTextContent(/by An administrator/);
  });

  it('wraps a long learner name, course title and note', async () => {
    const word = 'x'.repeat(70);
    const rendered = await render({
      'certificate.get': () => ({
        ...revoked,
        learnerName: 'Bartholomew-Maximilian Featherstonehaugh-Wolfeschlegel',
        courseTitle: `Course ${word}`,
        history: [
          { ...revoked.history[0], note: `${'n'.repeat(500)} ${word}` },
        ],
      }),
    });
    await lookUp(rendered);

    const details = (await screen.findByText(/Featherstonehaugh/))
      .parentElement;
    expect(details).toHaveClass(
      'min-w-0',
      'flex-1',
      'basis-full',
      'break-words',
      'sm:basis-0',
    );
    expect(details?.parentElement).toHaveClass('flex-wrap');
    expect(screen.getByText(valid.certificateId)).toHaveClass('break-all');
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
  });
});

describe('the Certificates screen, with the keyboard', () => {
  const statuses = () =>
    screen.getAllByRole('status').map((status) => status.textContent);

  it('asks before Escape discards a typed note, and Keep editing keeps it', async () => {
    const rendered = await render();
    await lookUp(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Revoke' }),
    );
    await rendered.user.type(await screen.findByLabelText('Note'), 'Why');

    await rendered.user.keyboard('{Escape}');
    expect(await screen.findByText('Discard unsaved changes?')).toBeVisible();

    await rendered.user.click(
      screen.getByRole('button', { name: 'Keep editing' }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Discard unsaved changes?')).toBeNull(),
    );
    expect(screen.getByLabelText('Note')).toHaveValue('Why');
  });

  it('closes on Escape with nothing typed, and Cancel then reopen shows an empty note', async () => {
    const rendered = await render();
    await lookUp(rendered);
    const revoke = await screen.findByRole('button', { name: 'Revoke' });
    await rendered.user.click(revoke);
    await screen.findByRole('dialog');
    await rendered.user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await rendered.user.click(revoke);
    await rendered.user.type(await screen.findByLabelText('Note'), 'Why');
    await rendered.user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();

    await rendered.user.click(revoke);
    expect(await screen.findByLabelText('Note')).toHaveValue('');
  });

  it('returns focus to Revoke when the dialog is dismissed', async () => {
    const rendered = await render();
    await lookUp(rendered);
    const revoke = await screen.findByRole('button', { name: 'Revoke' });
    await rendered.user.click(revoke);
    await screen.findByRole('dialog');

    await rendered.user.keyboard('{Escape}');

    await waitFor(() => expect(revoke).toHaveFocus());
  });

  it('returns focus to Restore when its dialog is dismissed', async () => {
    const rendered = await render({ 'certificate.get': () => revoked });
    await lookUp(rendered);
    const restore = await screen.findByRole('button', { name: 'Restore' });
    await rendered.user.click(restore);
    await screen.findByRole('dialog');

    await rendered.user.keyboard('{Escape}');

    await waitFor(() => expect(restore).toHaveFocus());
  });

  it('focuses Restore after a revoke and announces it', async () => {
    let current = valid;
    const rendered = await render({
      'certificate.get': () => current,
      'certificate.revoke': () => {
        current = revoked;
        return revoked;
      },
    });
    await lookUp(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Revoke' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Note')).toHaveAccessibleDescription(
      '0/500',
    );
    expect(within(dialog).getByText('0/500')).not.toHaveAttribute('aria-live');
    await rendered.user.click(
      within(dialog).getByRole('button', { name: 'Revoke certificate' }),
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Restore' })).toHaveFocus(),
    );
    await waitFor(() => expect(statuses()).toContain('Certificate revoked.'));
  });

  it('focuses Revoke after a restore and announces it', async () => {
    let current = revoked;
    const rendered = await render({
      'certificate.get': () => current,
      'certificate.restore': () => {
        current = valid;
        return valid;
      },
    });
    await lookUp(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Restore' }),
    );
    await rendered.user.click(
      screen.getByRole('button', { name: 'Restore certificate' }),
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Revoke' })).toHaveFocus(),
    );
    await waitFor(() => expect(statuses()).toContain('Certificate restored.'));
  });

  it('keeps focus on a pending Revoke certificate and sends nothing on a second press', async () => {
    const rendered = await render({
      'certificate.revoke': () => new Promise(() => {}),
    });
    await lookUp(rendered);
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Revoke' }),
    );
    await rendered.user.click(
      screen.getByRole('button', { name: 'Revoke certificate' }),
    );

    const pending = await screen.findByRole('button', { name: 'Revoking…' });
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    pending.focus();
    await rendered.user.click(pending);
    expect(pending).toHaveFocus();
    expect(
      rendered.calls.filter((c) => c.path === 'certificate.revoke'),
    ).toHaveLength(1);
  });
});

describe('the Certificates screen, as a page', () => {
  it('names the tab', async () => {
    await render();

    expect(document.title).toBe('Certificates · Discava');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Certificates' }),
    ).toBeInTheDocument();
  });

  it('says it is looking up the certificate', async () => {
    const rendered = await render({
      'certificate.get': () => new Promise(() => {}),
    });
    await lookUp(rendered);

    await waitFor(() =>
      expect(
        screen.getAllByRole('status').map((status) => status.textContent),
      ).toContain('Looking up the certificate…'),
    );
  });
});

describe('the Certificates screen, with the ID in the address', () => {
  const getCalls = (rendered: Awaited<ReturnType<typeof render>>) =>
    rendered.calls.filter((c) => c.path === 'certificate.get');

  it('opens on the ID in the address, fills the field and looks it up once', async () => {
    const rendered = await render({}, '/certificates?id=ABCD');

    expect(await screen.findByText('Sam Learner')).toBeInTheDocument();
    expect(screen.getByLabelText('Certificate ID')).toHaveValue('ABCD');
    expect(getCalls(rendered)).toEqual([
      { path: 'certificate.get', input: { certificateId: 'ABCD' } },
    ]);
  });

  it('pushes the trimmed ID on Look up, and Back restores the earlier one with the field', async () => {
    const rendered = await render({}, '/certificates?id=ABCD');
    await screen.findByText('Sam Learner');

    const field = screen.getByLabelText('Certificate ID');
    await rendered.user.clear(field);
    await rendered.user.type(field, '  WXYZ  ');
    await rendered.user.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() =>
      expect(rendered.router.state.location.search).toEqual({ id: 'WXYZ' }),
    );

    act(() => rendered.router.history.back());
    await waitFor(() => expect(field).toHaveValue('ABCD'));
    expect(rendered.router.state.location.search).toEqual({ id: 'ABCD' });
  });

  it.each([
    ['empty', '/certificates?id='],
    ['101 characters long', `/certificates?id=${'a'.repeat(101)}`],
  ])('drops a %s ID from the address', async (_, entry) => {
    const rendered = await render({}, entry);

    await screen.findByLabelText('Certificate ID');
    await waitFor(() =>
      expect(rendered.router.state.location.search).toEqual({}),
    );
    expect(rendered.router.state.location.href).toBe('/certificates');
    expect(getCalls(rendered)).toHaveLength(0);
  });
});
