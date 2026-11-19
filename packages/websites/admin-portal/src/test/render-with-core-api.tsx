/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createRenderWithApi,
  type RenderWithApi,
} from '@discava/common-web-utils/testing';
import type { AppRouter } from '@discava/core-api';
import { CoreApiTRPCContext } from '../api';

// Re-exported so tests need a single import from this file.
export {
  type ApiCall,
  ApiError,
  type Handler,
  PUBLIC_MEDIA_URL,
  type RenderedWithApi,
} from '@discava/common-web-utils/testing';

export const renderWithCoreApi: RenderWithApi<AppRouter> =
  createRenderWithApi(CoreApiTRPCContext);
