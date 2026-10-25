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
  // Whether the player must send credentials for it: the signed CloudFront
  // cookies set alongside. Not in local dev, where S3Mock serves the video
  // unsigned and refuses credentialed cross-origin requests (#137).
  withCredentials: z.boolean(),
});

export type IVideoUrlOutput = z.output<typeof VideoUrlOutputSchema>;

export const FileUrlInputSchema = ContentItemRefSchema;

export type IFileUrlInput = z.output<typeof FileUrlInputSchema>;

// A short-lived link to download a file item's file (#102).
export const FileUrlOutputSchema = z.object({
  url: z.string(),
});

export type IFileUrlOutput = z.output<typeof FileUrlOutputSchema>;
