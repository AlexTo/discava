/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ReactNode, useCallback, useRef, useState } from 'react';
import { DiscardChangesDialog } from '../components/discard-changes-dialog';

/**
 * Makes a dialog ask before it closes with unsaved changes. Spread
 * `contentProps` onto DialogContent, use `requestClose` for the Close button
 * and render `confirmation` once inside the dialog. Cancel calls `discard`
 * directly.
 */
export function useDiscardGuard({
  dirty,
  discard,
}: {
  dirty: boolean;
  /** Close the dialog and reset its form. */
  discard: () => void;
}): {
  contentProps: {
    onEscapeKeyDown: (event: KeyboardEvent) => void;
    onInteractOutside: (event: Event) => void;
  };
  requestClose: () => void;
  confirmation: ReactNode;
} {
  const [confirming, setConfirming] = useState(false);
  // Read when the question is asked: by the time an effect could, the
  // question's own dialog has already taken focus.
  const previous = useRef<Element | null>(null);

  const onCloseAutoFocus = useCallback((event: Event) => {
    const element = previous.current;
    previous.current = null;
    if (element instanceof HTMLElement && element.isConnected) {
      event.preventDefault();
      element.focus();
    }
  }, []);

  const doDiscard = useCallback(() => {
    setConfirming(false);
    discard();
  }, [discard]);

  const requestClose = useCallback(() => {
    if (dirty) {
      previous.current = document.activeElement;
      setConfirming(true);
    } else {
      doDiscard();
    }
  }, [dirty, doDiscard]);

  // The guard decides what closing means, so Radix's own close is stopped.
  const intercept = useCallback(
    (event: Event) => {
      event.preventDefault();
      requestClose();
    },
    [requestClose],
  );

  return {
    contentProps: { onEscapeKeyDown: intercept, onInteractOutside: intercept },
    requestClose,
    confirmation: (
      <DiscardChangesDialog
        open={confirming}
        onOpenChange={setConfirming}
        onDiscard={doDiscard}
        onCloseAutoFocus={onCloseAutoFocus}
      />
    ),
  };
}
