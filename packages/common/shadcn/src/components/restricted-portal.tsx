/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ReactNode } from 'react';
import { Button } from './ui/button';

// What a portal shows someone signed in without the role it's for (#235), in
// place of the whole portal: what it's for, where to go instead, and a way to
// sign out (e.g. to sign in as someone else).
export function RestrictedPortal({
  title,
  children,
  links,
  onSignOut,
}: {
  title: string;
  children: ReactNode;
  links: { label: string; href: string }[];
  onSignOut: () => void;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <div className="space-y-2 text-sm text-muted-foreground">
          {children}
        </div>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          {links.map(({ label, href }) => (
            <Button key={href} asChild>
              <a href={href}>{label}</a>
            </Button>
          ))}
          <Button variant="outline" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
