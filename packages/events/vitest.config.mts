/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/events',
  resolve: {
    // Workspace packages without package exports (e.g.
    // @discava/common-server-utils/*) resolve through tsconfig paths, as for tsc.
    tsconfigPaths: true,
    alias: {
      // @discava/core-table has no package.json `main`/`exports`, so it
      // resolves for tsc/tsx via tsconfig `paths` but not for Vite; alias it
      // directly to source so tests can import/mock it.
      '@discava/core-table': fileURLToPath(
        new URL('../databases/core-table/src/index.ts', import.meta.url),
      ),
      // Same reason as @discava/core-table above.
      '@discava/search': fileURLToPath(
        new URL('../databases/search/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    passWithNoTests: true,
    name: '@discava/events',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory:
        '../../dist/packages/events/test-output/vitest/coverage',
      provider: 'v8' as const,
      enabled: true,
      reporter: ['lcov'],
    },
  },
}));
