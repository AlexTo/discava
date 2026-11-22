/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { RuntimeConfigContext } from '@discava/common-web-utils/runtime-config';
import { render, screen, waitFor } from '@testing-library/react';
import type { AuthContextProps } from 'react-oidc-context';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  value: { isLoading: false, error: undefined } as Partial<AuthContextProps>,
}));
vi.mock('react-oidc-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-oidc-context')>();
  return { ...actual, useAuth: () => authState.value };
});

const { default: CognitoAuth } = await import('./cognito-auth');

const renderAuth = (
  runtimeConfig: Record<string, unknown>,
  autoSignIn?: boolean,
  fallback?: React.ReactNode,
) =>
  render(
    <RuntimeConfigContext.Provider value={runtimeConfig}>
      <CognitoAuth
        autoSignIn={autoSignIn}
        onReturn={() => {}}
        fallback={fallback}
      >
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

  it('shows the fallback instead of the spinner while signing in', async () => {
    authState.value = { isLoading: true, error: undefined };

    renderAuth(
      { localOidc: { authority: 'http://local', clientId: 'x' } },
      false,
      <p>Signing you in…</p>,
    );

    expect(await screen.findByText('Signing you in…')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Loading' }),
    ).not.toBeInTheDocument();
  });

  it('shows the fallback while autoSignIn redirects', async () => {
    authState.value = {
      isLoading: false,
      isAuthenticated: false,
      error: undefined,
      signinRedirect: vi.fn(),
    };

    renderAuth(
      { localOidc: { authority: 'http://local', clientId: 'x' } },
      true,
      <p>Signing you in…</p>,
    );

    expect(await screen.findByText('Signing you in…')).toBeInTheDocument();
  });

  it('keeps the page shown while it redirects to sign in', async () => {
    authState.value = {
      isLoading: true,
      activeNavigator: 'signinRedirect',
      error: undefined,
    };

    renderAuth({ localOidc: { authority: 'http://local', clientId: 'x' } });

    expect(await screen.findByText('Protected content')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Loading' }),
    ).not.toBeInTheDocument();
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

  describe('with autoSignIn', () => {
    const localOidc = {
      localOidc: { authority: 'http://local', clientId: 'x' },
    };

    it('redirects to sign-in when nobody is signed in', async () => {
      const signinRedirect = vi.fn();
      authState.value = {
        isLoading: false,
        isAuthenticated: false,
        error: undefined,
        signinRedirect,
      };

      renderAuth(localOidc, true);

      await waitFor(() => expect(signinRedirect).toHaveBeenCalledTimes(1));
      expect(signinRedirect).toHaveBeenCalledWith({
        state: { returnTo: expect.stringMatching(/^\//) },
      });
      expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    });

    it('does not redirect while the sign-in is still loading', () => {
      const signinRedirect = vi.fn();
      authState.value = {
        isLoading: true,
        isAuthenticated: false,
        error: undefined,
        signinRedirect,
      };

      renderAuth(localOidc, true);

      expect(signinRedirect).not.toHaveBeenCalled();
    });

    it('renders the protected content once signed in', async () => {
      authState.value = {
        isLoading: false,
        isAuthenticated: true,
        error: undefined,
        signinRedirect: vi.fn(),
      };

      renderAuth(localOidc, true);

      expect(await screen.findByText('Protected content')).toBeInTheDocument();
    });

    it("shows an error if the sign-in service couldn't be reached", async () => {
      authState.value = {
        isLoading: false,
        isAuthenticated: false,
        error: Object.assign(new Error('network down'), {
          source: 'signinCallback' as const,
        }),
        signinRedirect: vi.fn(),
      };

      renderAuth(localOidc, true);

      expect(
        await screen.findByText("Couldn't sign you in"),
      ).toBeInTheDocument();
    });
  });
});
