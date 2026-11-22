/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'rolldown';

/** Each Lambda's bundle name and its entry file. */
const LAMBDAS: [name: string, input: string][] = [
  ['post-confirmation', 'src/identity/post-confirmation.ts'],
  ['transcode-complete', 'src/media/transcode-complete.ts'],
  ['transcribe-complete', 'src/media/transcribe-complete.ts'],
  ['transcode-cleanup', 'src/media/transcode-cleanup.ts'],
  ['analytics-update', 'src/analytics/analytics-update.ts'],
  ['progress-recalculation', 'src/progress/progress-recalculation.ts'],
  ['search-indexing', 'src/search/search-indexing.ts'],
  ['caption-translation', 'src/media/caption-translation.ts'],
  ['transcode-reconciler', 'src/media/transcode-reconciler.ts'],
  ['pre-token-generation', 'src/identity/pre-token-generation.ts'],
  ['search-reindex', 'src/search/search-reindex.ts'],
  ['transcript-indexing', 'src/search/transcript-indexing.ts'],
  ['transcript-reindex', 'src/search/transcript-reindex.ts'],
  ['stream-router', 'src/router/stream-router.ts'],
  ['notification-delivery', 'src/notifications/notification-delivery.ts'],
  ['notification-unsubscribe', 'src/notifications/notification-unsubscribe.ts'],
  ['earnings-recording', 'src/earnings/earnings-recording.ts'],
  ['payout-run', 'src/earnings/payout-run.ts'],
  ['stripe-webhook', 'src/payments/stripe-webhook-handler.ts'],
  ['certificate-reminder', 'src/certificates/certificate-reminder.ts'],
];

export default defineConfig(
  LAMBDAS.map(([name, input]) => ({
    tsconfig: 'tsconfig.lib.json',
    input,
    output: {
      file: `../../dist/packages/events/bundle/lambda/${name}/index.js`,
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  })),
);
