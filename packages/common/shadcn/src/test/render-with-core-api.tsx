/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ApiCall,
  ApiError,
  createRenderWithApi,
  type Handler,
  type RenderWithApi,
} from '@discava/common-web-utils/testing';
import type { AppRouter } from '@discava/core-api';
import { CoreApiTRPCContext } from '../lib/core-api';

export type { ApiCall, Handler };
// Re-exported so tests don't need a second import from the shared helpers.
export { ApiError };

// Renders `ui` inside a fresh React Query client and a core API whose
// procedures are answered by `handlers` (keyed by path, e.g.
// 'notification.list').
export const renderWithCoreApi: RenderWithApi<AppRouter> =
  createRenderWithApi(CoreApiTRPCContext);
