/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AppRouter } from '@discava/admin-api';
import {
  createRenderWithApi,
  type RenderWithApi,
} from '@discava/common-web-utils/testing';
import { AdminApiTRPCContext } from '../api';

// Re-exported so tests need a single import from this file.
export {
  type ApiCall,
  ApiError,
  type Handler,
  PUBLIC_MEDIA_URL,
  type RenderedWithApi,
} from '@discava/common-web-utils/testing';

export const renderWithAdminApi: RenderWithApi<AppRouter> =
  createRenderWithApi(AdminApiTRPCContext);
