/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
/// <reference types='vitest' />
import { defineConfig } from 'vite';
import {
  LOCAL_PORTAL_PORTS,
  LOCAL_PORTAL_PREVIEW_PORTS,
} from '../../common/infra-config/src/local-portals.ts';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/packages/websites/instructor-portal',
  server: {
    port: LOCAL_PORTAL_PORTS.instructor,
    host: 'localhost',
  },
  preview: {
    port: LOCAL_PORTAL_PREVIEW_PORTS.instructor,
    host: 'localhost',
  },
  plugins: [
    tanstackRouter({
      routesDirectory: resolve(import.meta.dirname, 'src/routes'),
      generatedRouteTree: resolve(import.meta.dirname, 'src/routeTree.gen.ts'),
    }),
    react(),
    tailwindcss(),
  ],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  build: {
    outDir: '../../../dist/packages/websites/instructor-portal/bundle',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: '@discava/instructor-portal',
    setupFiles: ['src/test/setup.ts'],
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Component tests drive Tiptap editors and large dialogs through jsdom:
    // under a second each locally, but CI on main runs every project's tests
    // at once on one runner, where the quiz builder's took over 5s (vitest's
    // default) and failed. A test that hangs still fails, just later.
    testTimeout: 15_000,
    reporters: ['default'],
    coverage: {
      reportsDirectory:
        '../../../dist/packages/websites/instructor-portal/test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
  resolve: { tsconfigPaths: true, dedupe: ['react', 'react-dom'] },
  define: { global: {} },
}));
