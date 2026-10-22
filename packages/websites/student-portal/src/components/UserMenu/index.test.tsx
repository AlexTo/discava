/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthContext, type AuthContextProps } from 'react-oidc-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeConfigContext } from '../RuntimeConfig';
import { UserMenu } from './index';

const removeUser = vi.fn(async () => {});
let navigatedTo: string | undefined;

const signOut = async (runtimeConfig: object, authority: string) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ end_session_endpoint: `${authority}/logout` }),
    ),
  );
  const auth = {
    user: { profile: { sub: 'student-1', given_name: 'Bob' } },
    settings: { authority, client_id: 'client-1' },
    removeUser,
  } as unknown as AuthContextProps;
  const user = userEvent.setup();
  render(
    <RuntimeConfigContext.Provider value={runtimeConfig}>
      <AuthContext.Provider value={auth}>
        <UserMenu />
      </AuthContext.Provider>
    </RuntimeConfigContext.Provider>,
  );

  await user.click(screen.getByRole('button', { name: 'Open user menu' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
  await waitFor(() => expect(navigatedTo).toBeDefined());
  return new URL(navigatedTo!);
};

beforeEach(() => {
  navigatedTo = undefined;
  // jsdom can't navigate; record where sign-out sends the browser instead.
  vi.stubGlobal('location', {
    origin: 'http://localhost:4201',
    set href(url: string) {
      navigatedTo = url;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UserMenu sign-out', () => {
  it('uses Cognito’s own logout_uri when deployed', async () => {
    const url = await signOut(
      { cognitoProps: {} },
      'https://cognito-idp.ap-southeast-2.amazonaws.com/pool',
    );

    expect(removeUser).toHaveBeenCalled();
    expect(url.searchParams.get('logout_uri')).toBe('http://localhost:4201');
    expect(url.searchParams.get('client_id')).toBe('client-1');
  });

  it('uses the standard post_logout_redirect_uri with local dev’s OIDC server (#226)', async () => {
    const url = await signOut(
      {
        localOidc: {
          authority: 'http://localhost:9400/discava',
          clientId: 'local',
        },
      },
      'http://localhost:9400/discava',
    );

    expect(url.origin + url.pathname).toBe(
      'http://localhost:9400/discava/logout',
    );
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'http://localhost:4201',
    );
    expect(url.searchParams.has('logout_uri')).toBe(false);
  });
});
