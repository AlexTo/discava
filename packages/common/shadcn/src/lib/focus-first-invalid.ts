/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Moves focus to the first field in `root` marked `aria-invalid="true"` (or
 * `data-invalid="true"`, for a control whose role does not take aria-invalid,
 * such as a drop zone), so a
 * submit with problems lands on the first one. Call it once the form has
 * validated: it waits a tick for the fields' error state to render. Returns
 * nothing; with no invalid field it leaves focus where it is.
 */
export function focusFirstInvalid(root: ParentNode | null | undefined) {
  setTimeout(() => {
    const field = root?.querySelector<HTMLElement>(
      '[aria-invalid="true"], [data-invalid="true"]',
    );
    field?.focus();
  }, 0);
}
