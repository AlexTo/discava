/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signOut } from './sign-out';

const AUTHORITY = 'https://cognito-idp.ap-southeast-2.amazonaws.com/pool';
let navigatedTo: string | undefined;

const auth = () => ({
  settings: {
    authority: AUTHORITY,
    client_id: 'client-1',
    userStore: { remove: vi.fn(async () => null) },
  },
  removeUser: vi.fn(async () => {}),
});

const discovery = (metadata: object | Error) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (metadata instanceof Error) {
        throw metadata;
      }
      return Response.json(metadata);
    }),
  );

beforeEach(() => {
  navigatedTo = undefined;
  // jsdom can't navigate; record where sign-out sends the browser instead.
  vi.stubGlobal('location', {
    origin: 'https://admin.example',
    set href(url: string) {
      navigatedTo = url;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signOut', () => {
  it("ends the sign-in server's session, with Cognito's logout_uri", async () => {
    discovery({ end_session_endpoint: 'https://auth.example/logout' });
    const a = auth();

    await signOut(a as never, {});

    const url = new URL(navigatedTo!);
    expect(url.origin + url.pathname).toBe('https://auth.example/logout');
    expect(url.searchParams.get('logout_uri')).toBe('https://admin.example');
    expect(url.searchParams.get('client_id')).toBe('client-1');
  });

  it('forgets the user without telling the app, so no new sign-in races the logout', async () => {
    discovery({ end_session_endpoint: 'https://auth.example/logout' });
    const a = auth();

    await signOut(a as never, {});

    expect(a.settings.userStore.remove).toHaveBeenCalledWith(
      `user:${AUTHORITY}:client-1`,
    );
    expect(a.removeUser).not.toHaveBeenCalled();
  });

  it('uses the standard post_logout_redirect_uri with local dev’s OIDC server', async () => {
    discovery({ end_session_endpoint: 'http://localhost:9400/discava/logout' });

    await signOut(auth() as never, { localOidc: {} });

    const url = new URL(navigatedTo!);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://admin.example',
    );
    expect(url.searchParams.has('logout_uri')).toBe(false);
  });

  it('signs out of the portal only, when the server has no logout endpoint', async () => {
    discovery(new Error('offline'));
    const a = auth();

    await signOut(a as never, {});

    expect(a.removeUser).toHaveBeenCalled();
    expect(navigatedTo).toBe('https://admin.example');
  });
});
