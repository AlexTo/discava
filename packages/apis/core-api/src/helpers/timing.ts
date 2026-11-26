/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger();

// Above this a call is worth a log line on every stage, whatever its log
// level: a WARN shows even where the level is WARN.
const SLOW_MS = 1_000;

/**
 * Awaits `work` and logs a warning with how long it took when it took longer
 * than a second, whether it resolved or failed. Names the step in a slow
 * public catalogue call (#1146) so the logs show where the time goes.
 */
export const timed = async <T>(step: string, work: Promise<T>): Promise<T> => {
  const start = Date.now();
  try {
    return await work;
  } finally {
    const durationMs = Date.now() - start;
    if (durationMs >= SLOW_MS) {
      logger.warn('Slow step', { step, durationMs });
    }
  }
};
