/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'rolldown';

export default defineConfig([
  {
    tsconfig: 'tsconfig.lib.json',
    // The CloudFormation custom resource handler that syncs the indices onto
    // the deployed collection. Bundled the same way as the events' Lambda
    // handlers: a single CJS file with the AWS SDK left external.
    input: 'src/index-sync/handler.ts',
    output: {
      file: '../../../dist/packages/databases/search/bundle/index-sync/index.js',
      format: 'cjs',
      codeSplitting: false,
    },
    platform: 'node',
    external: [/@aws-sdk\/.*/],
  },
]);
