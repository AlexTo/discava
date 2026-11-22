/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { cn } from 'cn';
import { useEffect, useState } from 'react';

interface StatusMessageProps {
  /** The sentence to announce; null or '' shows nothing. */
  message: string | null;
  /** Visible (default) or screen-reader only. */
  visuallyHidden?: boolean;
  /** Clear after this many ms (default 5000). */
  clearAfter?: number;
}

/**
 * A live region that is mounted from the first render, so the first message
 * is announced. Setting the same message again announces it again.
 */
function StatusMessage({
  message,
  visuallyHidden = false,
  clearAfter = 5000,
}: StatusMessageProps) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (!message) {
      setText('');
      return;
    }
    // Clear for one frame so a repeated message is announced again.
    setText('');
    const frame = setTimeout(() => setText(message), 0);
    const clear = setTimeout(() => setText(''), clearAfter);
    return () => {
      clearTimeout(frame);
      clearTimeout(clear);
    };
  }, [message, clearAfter]);

  return (
    <div
      role="status"
      className={cn(
        visuallyHidden ? 'sr-only' : 'text-sm text-muted-foreground',
      )}
    >
      {text}
    </div>
  );
}

export type { StatusMessageProps };
export { StatusMessage };
