/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { ContentItemRefSchema } from './completion.js';

export const VideoUrlInputSchema = ContentItemRefSchema;

export type IVideoUrlInput = z.output<typeof VideoUrlInputSchema>;

// The video's HLS manifest. The signed cookies that let the player fetch it
// and its renditions and segments come back as Set-Cookie headers, never in
// the output, so they stay HttpOnly.
export const VideoUrlOutputSchema = z.object({
  url: z.string(),
});

export type IVideoUrlOutput = z.output<typeof VideoUrlOutputSchema>;
