/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import type { AuthContextProps } from 'react-oidc-context';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeConfigContext } from '../RuntimeConfig';

const authState = vi.hoisted(() => ({
  value: { isLoading: false, error: undefined } as Partial<AuthContextProps>,
}));
vi.mock('react-oidc-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-oidc-context')>();
  return { ...actual, useAuth: () => authState.value };
});

const { default: CognitoAuth } = await import('./index');

const renderAuth = (runtimeConfig: Record<string, unknown>) =>
  render(
    <RuntimeConfigContext.Provider value={runtimeConfig}>
      <CognitoAuth>
        <p>Protected content</p>
      </CognitoAuth>
    </RuntimeConfigContext.Provider>,
  );

describe('CognitoAuth', () => {
  it('shows a configuration error when neither cognitoProps nor localOidc is set', () => {
    renderAuth({});

    expect(
      screen.getByText('Runtime config configuration error'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('shows a spinner while signing in', async () => {
    authState.value = { isLoading: true, error: undefined };

    renderAuth({ localOidc: { authority: 'http://local', clientId: 'x' } });

    expect(
      await screen.findByRole('status', { name: 'Loading' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it("shows an error if the sign-in service couldn't be reached", async () => {
    authState.value = {
      isLoading: false,
      error: Object.assign(new Error('network down'), {
        source: 'signinCallback' as const,
      }),
    };

    renderAuth({ localOidc: { authority: 'http://local', clientId: 'x' } });

    expect(await screen.findByText("Couldn't sign you in")).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('renders the protected content once signed in', async () => {
    authState.value = { isLoading: false, error: undefined };

    renderAuth({ localOidc: { authority: 'http://local', clientId: 'x' } });

    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });

  it('works from Cognito config too, not just localOidc', async () => {
    authState.value = { isLoading: false, error: undefined };

    renderAuth({
      cognitoProps: {
        region: 'us-east-1',
        userPoolId: 'pool',
        userPoolWebClientId: 'client',
      },
    });

    expect(await screen.findByText('Protected content')).toBeInTheDocument();
  });
});
