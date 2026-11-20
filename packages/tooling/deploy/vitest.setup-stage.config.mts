/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'vitest/config';

// The `test-setup-stage` target's config: only scripts/setup-stage.sh's
// tests, which vitest.config.mts leaves out. They run the script dozens of
// times, a few seconds each, and depend on nothing in this package, so they
// are a target of their own that Nx only runs again when the script, the
// stage config it reads or the tests change (the inputs are in project.json).
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/packages/tooling/deploy-setup-stage',
  test: {
    name: '@discava/tooling-deploy:setup-stage',
    watch: false,
    environment: 'node',
    include: ['src/setup-stage.test.ts'],
    reporters: ['default'],
  },
}));
