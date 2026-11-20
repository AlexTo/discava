/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import type { useAuth } from 'react-oidc-context';

// Type-only so routes/__root.tsx can use it without importing router.ts
// (which imports routeTree.gen and would close an import cycle).
export type RouterProviderContext = {
  runtimeConfig?: ReturnType<typeof useRuntimeConfig>;
  auth?: ReturnType<typeof useAuth>;
};

declare module '@tanstack/react-router' {
  interface HistoryState {
    // Set when a learner has just enrolled: the lesson page and the course
    // home then say so.
    enrolled?: boolean;
  }
}
