/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'rolldown';

export default defineConfig([
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/identity/post-confirmation.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/post-confirmation/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/media/transcode-complete.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/transcode-complete/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/media/transcribe-complete.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/transcribe-complete/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/media/transcode-cleanup.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/transcode-cleanup/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/analytics/analytics-update.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/analytics-update/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/progress/progress-recalculation.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/progress-recalculation/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/search/index-content.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/search-indexing/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/media/transcode-reconciler.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/transcode-reconciler/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/identity/pre-token-generation.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/pre-token-generation/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/search/search-reindex.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/search-reindex/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/router/stream-router.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/stream-router/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/notifications/delivery.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/notification-delivery/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/notifications/unsubscribe.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/notification-unsubscribe/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
]);
