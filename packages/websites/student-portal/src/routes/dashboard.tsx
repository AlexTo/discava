/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

// The signed-in home used to live here; it's `/` now. Kept so old links and
// bookmarks still work.
export const Route = createFileRoute('/dashboard')({
  beforeLoad: () => {
    throw redirect({ to: '/', replace: true });
  },
});
