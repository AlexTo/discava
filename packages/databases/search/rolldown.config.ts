/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'rolldown';

export default defineConfig([
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/index-sync/handler.ts',
    output: {
      file: '../../../dist/packages/databases/search/bundle/lambda/index-sync/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
]);
