/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { rmSync } from 'node:fs';

/**
 * Deletes `tmp/local-dev/`: the event runner's ffmpeg jobs (`transcode/`) and
 * sent emails (`emails/`), the local Stripe secrets (`secrets/`) and
 * ElasticMQ's generated config (`elasticmq/`).
 */
export const clearLocalDevFiles = (dir: string) => {
  rmSync(dir, { recursive: true, force: true });
};
