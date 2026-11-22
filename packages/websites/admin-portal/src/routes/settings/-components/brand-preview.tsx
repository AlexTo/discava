/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';

export interface BrandPreviewProps {
  logoUrl: string;
  name: string;
  showName: boolean;
}

// What visitors will see, drawn from the unsaved form: a portal header, a
// primary and a secondary button, a link and an active navigation item.
export function BrandPreview({ logoUrl, name, showName }: BrandPreviewProps) {
  return (
    <section className="space-y-3" aria-labelledby="brand-preview-title">
      <h2 id="brand-preview-title" className="text-lg font-semibold">
        Preview
      </h2>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex h-16 items-center gap-2 border-b bg-background px-4">
          <img
            src={logoUrl}
            alt={`${name} logo`}
            height={40}
            className="h-10 w-auto max-w-40 shrink object-contain"
          />
          {showName && (
            <span className="hidden truncate text-sm font-semibold sm:inline">
              {name}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <Button type="button" tabIndex={-1}>
            Primary button
          </Button>
          <Button type="button" variant="secondary" tabIndex={-1}>
            Secondary button
          </Button>
          <span className="text-sm underline underline-offset-4">A link</span>
          <span className="rounded-md bg-sidebar-accent px-3 py-1 text-sm font-medium text-sidebar-accent-foreground">
            Active menu item
          </span>
        </div>
      </div>
    </section>
  );
}
