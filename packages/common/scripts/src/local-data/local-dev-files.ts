/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { rmSync } from 'node:fs';

/**
 * Deletes the event runner's working files: `tmp/local-dev/`, which holds the
 * ffmpeg jobs in `transcode/` and the local inbox's sent emails in `emails/` and the saved Stripe key and
 * signing secret in `secrets/`.
 */
export const clearLocalDevFiles = (dir: string) => {
  rmSync(dir, { recursive: true, force: true });
};
