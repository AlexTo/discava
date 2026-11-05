/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/packages/databases/search',
  resolve: {
    // Workspace packages without package exports resolve through tsconfig
    // paths, as for tsc.
    tsconfigPaths: true,
    alias: {
      // @discava/core-table has no package.json `main`/`exports`, so it
      // resolves for tsc/tsx via tsconfig `paths` but not for Vite; alias it
      // directly to source so tests can import/mock it (as core-api's own
      // vitest config does for the same reason).
      '@discava/core-table': fileURLToPath(
        new URL('../core-table/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    passWithNoTests: true,
    name: '@discava/search',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory:
        '../../../dist/packages/databases/search/test-output/vitest/coverage',
      provider: 'v8' as const,
      enabled: true,
      reporter: ['lcov'],
    },
  },
}));
