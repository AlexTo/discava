/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { cn } from 'cn';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from './ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';

interface ResponsivePanelProps {
  /** The trigger's text, e.g. "Course outline", "Filters". */
  label: string;
  /** Shown beside the label, e.g. the current lesson's title, "2 active". */
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Content that is a closed, full-width disclosure button below the `lg`
 * breakpoint and always shown from `lg` up. The switch is CSS only: no width
 * is measured, so first paint is the same either way.
 */
export function ResponsivePanel({
  label,
  summary,
  children,
  className,
}: ResponsivePanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start gap-2 lg:hidden"
        >
          <span className="shrink-0">{label}</span>
          {summary ? (
            <span className="min-w-0 flex-1 truncate text-left font-normal text-muted-foreground">
              {summary}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <ChevronDown
            className={cn(
              'size-4 shrink-0 transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 lg:mt-0 lg:!block">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
