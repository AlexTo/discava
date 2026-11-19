/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createRenderWithApi,
  type RenderWithApi,
} from '@discava/common-web-utils/testing';
import type { AppRouter } from '@discava/instructor-api';
import { InstructorApiTRPCContext } from '../api';

// Re-exported so tests need a single import from this file.
export {
  type ApiCall,
  ApiError,
  type Handler,
  PUBLIC_MEDIA_URL,
  type RenderedWithApi,
} from '@discava/common-web-utils/testing';

export const renderWithInstructorApi = createRenderWithApi(
  InstructorApiTRPCContext,
);
