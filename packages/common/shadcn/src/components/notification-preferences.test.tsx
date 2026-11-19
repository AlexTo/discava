/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  type NotificationPreferenceRow,
  NotificationPreferences,
  type NotificationPreferencesProps,
} from './notification-preferences';

const row = (
  type: string,
  overrides: Partial<NotificationPreferenceRow> = {},
): NotificationPreferenceRow => ({
  type,
  name: `Name of ${type}`,
  description: `Description of ${type}`,
  emailEnabled: true,
  required: false,
  ...overrides,
});

// The portal owns the rows; this stands in for it, updating them once a save
// succeeds as the query cache does.
const renderPreferences = (
  props: Partial<NotificationPreferencesProps> = {},
) => {
  const Portal = () => {
    const [rows, setRows] = useState(
      props.preferences ?? [
        row('assignment.graded'),
        row('account.security', { required: true }),
      ],
    );
    return (
      <NotificationPreferences
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        {...props}
        preferences={rows}
        onChange={async (type, emailEnabled) => {
          await (props.onChange ?? vi.fn(async () => {}))(type, emailEnabled);
          setRows((all) =>
            all.map((r) => (r.type === type ? { ...r, emailEnabled } : r)),
          );
        }}
      />
    );
  };
  return render(<Portal />);
};

describe('NotificationPreferences', () => {
  it('shows a row per type with its name, description and email switch', () => {
    renderPreferences();

    expect(screen.getByText('Name of assignment.graded')).toBeInTheDocument();
    expect(
      screen.getByText('Description of assignment.graded'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: /Name of assignment\.graded/ }),
    ).toBeChecked();
  });

  it('shows an off switch for a type whose email is off', () => {
    renderPreferences({
      preferences: [row('assignment.graded', { emailEnabled: false })],
    });

    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('calls onChange with the type and the new value', async () => {
    const onChange = vi.fn(async () => {});
    renderPreferences({ onChange });

    await userEvent.click(
      screen.getByRole('switch', { name: /Name of assignment\.graded/ }),
    );

    expect(onChange).toHaveBeenCalledWith('assignment.graded', false);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: /assignment\.graded/ }),
    ).not.toBeChecked();
  });

  it('shows a required type as Always on, with its switch disabled', async () => {
    const onChange = vi.fn(async () => {});
    renderPreferences({ onChange });

    const required = screen.getByRole('switch', {
      name: /Name of account\.security/,
    });
    expect(required).toBeDisabled();
    expect(required).toBeChecked();
    expect(screen.getByText('Always on')).toBeInTheDocument();

    await userEvent.click(required);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reverts the switch and shows an error when saving fails', async () => {
    const onChange = vi.fn(async () => {
      throw new Error('Could not reach the server');
    });
    renderPreferences({ onChange });

    const toggle = screen.getByRole('switch', {
      name: /Name of assignment\.graded/,
    });
    await userEvent.click(toggle);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't save. Could not reach the server",
    );
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('shows skeleton rows while loading and no switches', () => {
    renderPreferences({ preferences: [], isLoading: true });

    expect(
      screen.getByLabelText('Loading notification settings'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('shows an error with a Try again button', async () => {
    const onRetry = vi.fn();
    renderPreferences({ preferences: [], isError: true, onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
