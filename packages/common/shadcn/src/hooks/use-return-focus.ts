/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns focus to the element focused before a dialog opened, for dialogs
 * opened from state with no trigger element. Pass `onCloseAutoFocus` to
 * DialogContent, AlertDialogContent or SheetContent.
 */
export function useReturnFocus(open: boolean) {
  const previous = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      previous.current = document.activeElement;
    }
  }, [open]);

  const onCloseAutoFocus = useCallback((event: Event) => {
    const element = previous.current;
    previous.current = null;
    if (element instanceof HTMLElement && element.isConnected) {
      event.preventDefault();
      element.focus();
    }
  }, []);

  return { onCloseAutoFocus };
}
