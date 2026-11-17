/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen } from '@testing-library/react';
import type { AuthContextProps } from 'react-oidc-context';
import { describe, expect, it } from 'vitest';
import { renderWithCoreApi } from '../test/render-with-core-api';
import SiteLayout from './SiteLayout';

const portals = {
  StudentPortal: 'https://learn.example',
  InstructorPortal: 'https://teach.example',
};

const signedInAs = (groups: string[]) =>
  ({
    user: {
      access_token: 'test-token',
      profile: { sub: 'user-1', 'cognito:groups': groups },
    },
  }) as unknown as Partial<AuthContextProps>;

const renderLayout = (auth: Partial<AuthContextProps>) =>
  renderWithCoreApi(<SiteLayout>Page</SiteLayout>, {
    auth,
    runtimeConfig: { portals },
    handlers: { 'notification.unreadCount': () => ({ unreadCount: 2 }) },
  });

describe('SiteLayout', () => {
  it("links an instructor to the instructor portal's My Courses, before My Learning (#67)", async () => {
    renderLayout(signedInAs(['instructor', 'student']));

    const instructor = await screen.findByRole('link', { name: 'Instructor' });
    expect(instructor).toHaveAttribute(
      'href',
      'https://teach.example/my-courses',
    );
    const myLearning = screen.getByRole('link', { name: 'My Learning' });
    expect(
      instructor.compareDocumentPosition(myLearning) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("doesn't offer the instructor portal to someone who isn't an instructor", async () => {
    renderLayout(signedInAs(['student']));

    expect(
      await screen.findByRole('link', { name: 'My Learning' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Instructor' })).toBeNull();
  });

  it('shows the notification bell to someone signed in, after My Learning', async () => {
    renderLayout(signedInAs(['student']));

    const bell = await screen.findByRole('button', {
      name: 'Notifications, 2 unread',
    });
    const myLearning = screen.getByRole('link', { name: 'My Learning' });
    expect(
      myLearning.compareDocumentPosition(bell) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("doesn't show the notification bell to someone signed out", async () => {
    renderWithCoreApi(<SiteLayout>Page</SiteLayout>, {
      signedIn: false,
      runtimeConfig: { portals },
    });

    expect(
      await screen.findByRole('link', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull();
  });
});
