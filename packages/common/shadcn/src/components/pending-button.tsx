/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { cn } from 'cn';
import * as React from 'react';
import { Button } from '#components/ui/button';

interface PendingButtonProps extends React.ComponentProps<typeof Button> {
  /** The action is running. */
  pending: boolean;
  /** Shown while pending, e.g. "Saving…". Ends with "…". */
  pendingLabel: string;
}

/**
 * A button for an action that is running. It stays focusable (never
 * `disabled`), so keyboard focus is not lost, but ignores clicks and form
 * submission until the action ends.
 */
function PendingButton({
  pending,
  pendingLabel,
  className,
  onClick,
  onClickCapture,
  children,
  ...props
}: PendingButtonProps) {
  return (
    <Button
      {...props}
      aria-disabled={pending ? true : props['aria-disabled']}
      className={cn(pending && 'cursor-not-allowed opacity-50', className)}
      onClickCapture={(event) => {
        if (pending) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClickCapture?.(event);
      }}
      onClick={pending ? undefined : onClick}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}

export type { PendingButtonProps };
export { PendingButton };
