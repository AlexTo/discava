/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, type Page } from '@playwright/test';

export type Role = 'student' | 'instructor' | 'admin';

// One of the local OIDC page's fixed test users (common/scripts'
// local-oidc/login.html). They share data with whoever uses the local stack,
// so scenarios only read as them; anything that writes uses newUser.
export interface TestUser {
  kind: 'test';
  name: 'Alice' | 'Bob' | 'Dan' | 'Carol';
}

// A user made for one scenario through the page's "Someone else" form. The
// page derives their sub from the username, so a unique username is a fresh
// user who sees nothing of anyone else's data.
export interface NewUser {
  kind: 'new';
  givenName: string;
  familyName: string;
  username: string;
  email: string;
  roles: Role[];
}

export type User = TestUser | NewUser;

export const testUser = (name: TestUser['name']): TestUser => ({
  kind: 'test',
  name,
});

// Unique per call: base 36 time plus a random suffix, in the characters the
// form's username field allows.
const uniqueSuffix = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const newUser = (givenName: string, roles: Role[]): NewUser => {
  const username = `e2e-${givenName.toLowerCase()}-${uniqueSuffix()}`;
  return {
    kind: 'new',
    givenName,
    familyName: 'E2e',
    username,
    email: `${username}@example.com`,
    roles,
  };
};

// Names unique to this run, for courses and the like, so scenarios never
// find each other's (or your local) data.
export const uniqueName = (label: string) => `${label} ${uniqueSuffix()}`;

// Signs in on the local OIDC page, which the portal has just sent the page to,
// and waits to be back on the portal.
export const signIn = async (page: Page, user: User) => {
  await page.waitForURL(/localhost:9400\/discava\/authorize/);
  if (user.kind === 'test') {
    await page
      .getByRole('button', { name: new RegExp(`^${user.name}\\b`) })
      .click();
  } else {
    await page.getByLabel('First name').fill(user.givenName);
    await page.getByLabel('Last name').fill(user.familyName);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Username').fill(user.username);
    for (const role of ['student', 'instructor', 'admin'] as const) {
      await page
        .getByRole('checkbox', { name: role, exact: true })
        .setChecked(user.roles.includes(role));
    }
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await page.waitForURL(/localhost:420[0-2]/);
  // Signed in: the portal's user menu, or, for someone without the portal's
  // role, its restricted page's "Sign out" (#235).
  await expect(
    page.getByRole('button', { name: /^(Open user menu|Sign out)$/ }),
  ).toBeVisible();
};
