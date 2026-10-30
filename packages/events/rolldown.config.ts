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
    input: 'src/search/search-indexer.ts',
    output: {
      file: '../../dist/packages/events/bundle/lambda/search-indexer/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
]);
