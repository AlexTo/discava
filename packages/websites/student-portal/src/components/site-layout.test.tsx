/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveBrand } from '@discava/common-branding/brand';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AuthContextProps } from 'react-oidc-context';
import { describe, expect, it } from 'vitest';
import { renderWithCoreApi } from '../test/render-with-core-api';
import SiteLayout from './site-layout';

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
  it('credits Discava in the footer, linking to the project site', async () => {
    renderLayout(signedInAs(['student']));

    expect(
      await screen.findByRole('link', { name: 'Discava' }),
    ).toHaveAttribute('href', 'https://alexto.github.io/discava');
  });

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

  describe('on a phone', () => {
    const openUserMenu = async () => {
      await userEvent.click(
        await screen.findByRole('button', { name: 'Open user menu' }),
      );
      return screen.findAllByRole('menuitem');
    };

    it("hides the top bar's links below sm", async () => {
      renderLayout(signedInAs(['instructor', 'student']));

      for (const name of ['Instructor', 'My Learning']) {
        const group = (await screen.findByRole('link', { name })).closest(
          'div',
        );
        expect(group).toHaveClass('hidden', 'sm:flex');
      }
    });

    it('lists My Learning then Instructor first in the user menu for an instructor', async () => {
      renderLayout(signedInAs(['instructor', 'student']));

      const items = await openUserMenu();

      expect(items.slice(0, 2).map((item) => item.textContent)).toEqual([
        'My Learning',
        'Instructor',
      ]);
      expect(items[0]).toHaveAttribute('href', '/my-learning');
      expect(items[1]).toHaveAttribute(
        'href',
        'https://teach.example/my-courses',
      );
      expect(items[0]).toHaveClass('sm:hidden');
      expect(items[1]).toHaveClass('sm:hidden');
    });

    it('lists only My Learning for a student who is not an instructor', async () => {
      renderLayout(signedInAs(['student']));

      await openUserMenu();

      const menu = screen.getByRole('menu');
      expect(
        within(menu).getByRole('menuitem', { name: 'My Learning' }),
      ).toBeInTheDocument();
      expect(
        within(menu).queryByRole('menuitem', { name: 'Instructor' }),
      ).toBeNull();
    });
  });

  describe('the brand', () => {
    const acme = resolveBrand(
      {
        name: 'Acme Academy',
        showNameBesideLogo: true,
        colour: null,
        logoKey: 'brand/logo/0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12.svg',
        iconKey: null,
        shareImageKey: null,
      },
      'https://media.test/',
    );

    it('shows the brand’s logo and name in the header', async () => {
      renderWithCoreApi(<SiteLayout>Page</SiteLayout>, {
        runtimeConfig: { portals },
        brand: acme,
      });

      const logo = await screen.findByRole('img', {
        name: 'Acme Academy logo',
      });
      expect(logo).toHaveAttribute(
        'src',
        'https://media.test/brand/logo/0193a5c8-7b1e-7a3c-9d2f-1e4b6c8a0f12.svg',
      );
      expect(screen.getByText('Acme Academy')).toBeInTheDocument();
    });

    it('does not crop a wide logo: it is contained, at the header height', async () => {
      renderWithCoreApi(<SiteLayout>Page</SiteLayout>, {
        runtimeConfig: { portals },
        brand: acme,
      });

      const logo = await screen.findByRole('img', {
        name: 'Acme Academy logo',
      });
      expect(logo).toHaveClass('object-contain', 'h-10', 'w-auto', 'max-w-40');
      expect(logo).not.toHaveClass('object-cover');
    });

    it('shows the Discava logo and name by default', async () => {
      renderWithCoreApi(<SiteLayout>Page</SiteLayout>, {
        runtimeConfig: { portals },
      });

      expect(
        await screen.findByRole('img', { name: 'Discava logo' }),
      ).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml'));
    });
  });
});
