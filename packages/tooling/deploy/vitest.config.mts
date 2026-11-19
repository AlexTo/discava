/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { fileURLToPath } from 'url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/packages/tooling/deploy',
  resolve: {
    tsconfigPaths: true,
    alias: {
      // @discava/core-table has no package.json `main`/`exports`, so it
      // resolves for tsc/tsx via tsconfig `paths` but not for Vite.
      '@discava/core-table': fileURLToPath(
        new URL('../../databases/core-table/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    passWithNoTests: true,
    name: '@discava/tooling-deploy',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Run by the `test-setup-stage` target (vitest.setup-stage.config.mts).
    exclude: [...configDefaults.exclude, 'src/setup-stage.test.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory:
        '../../../dist/packages/tooling/deploy/test-output/vitest/coverage',
      provider: 'v8' as const,
      enabled: true,
      reporter: ['lcov'],
    },
  },
}));
