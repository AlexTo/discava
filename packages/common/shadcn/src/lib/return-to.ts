/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Where to send someone after they sign in, from a value carried through the
// round trip to Cognito (the sign-in page's `redirect` search param, then the
// OIDC `state`). Only a path on this site is accepted: anything else (another
// origin, a protocol-relative `//host`, a non-string) gives undefined, so a
// crafted sign-in link can't redirect off the site afterwards. The sign-in
// page itself is refused too, since returning there would start over.
export const safeReturnTo = (value: unknown): string | undefined => {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\')
  ) {
    return undefined;
  }
  const base = 'https://portal.invalid';
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return undefined;
  }
  if (url.origin !== base || /^\/signin(\/|$)/.test(url.pathname)) {
    return undefined;
  }
  return `${url.pathname}${url.search}${url.hash}`;
};

// The page the browser is on, as safeReturnTo accepts it.
export const currentPath = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;
