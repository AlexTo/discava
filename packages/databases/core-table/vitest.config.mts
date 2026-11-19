/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/packages/databases/core-table',
  resolve: {
    // Workspace packages without package exports resolve through tsconfig
    // paths, as for tsc.
    tsconfigPaths: true,
  },
  test: {
    passWithNoTests: true,
    name: '@discava/core-table',
    watch: false,
    globals: true,
    environment: 'jsdom',
    // The entities and service resolve their table the way local dev does.
    env: { LOCAL_DEV: 'true' },
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory:
        '../../../dist/packages/databases/core-table/test-output/vitest/coverage',
      provider: 'v8' as const,
      enabled: true,
      reporter: ['lcov'],
    },
  },
}));
