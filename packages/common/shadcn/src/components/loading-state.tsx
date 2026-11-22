/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { cn } from 'cn';
import { Spinner } from '#components/ui/spinner';

interface LoadingStateProps {
  /** What is loading, as a sentence with an ellipsis: "Loading the course…". */
  label: string;
  /** A whole page (centred, larger) or a section (inline). Default section. */
  size?: 'page' | 'section';
}

function LoadingState({ label, size = 'section' }: LoadingStateProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 text-sm text-muted-foreground',
        size === 'page' && 'min-h-[50vh] justify-center text-base',
      )}
    >
      <Spinner aria-hidden="true" role="presentation" />
      <span>{label}</span>
    </div>
  );
}

export type { LoadingStateProps };
export { LoadingState };
