/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { useAuth } from 'react-oidc-context';
import type { useRuntimeConfig } from './hooks/useRuntimeConfig';

// Type-only so routes/__root.tsx can use it without importing router.ts
// (which imports routeTree.gen and would close an import cycle).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type RouterProviderContext = {
  runtimeConfig?: ReturnType<typeof useRuntimeConfig>;
  auth?: ReturnType<typeof useAuth>;
};
