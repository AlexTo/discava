/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Where local dev serves the three portals. The one definition of these ports:
// the stacks' CORS allow-lists, the Cognito callback URLs, local dev's links,
// the e2e helpers and each portal's vite.config.mts all read it from here.
// Dependency-free so a vite config, a Lambda and a CDK stack can all import it
// (`@discava/common-infra-config/local-portals`).
// Each project.json `ports` entry must match; local-portals.test.ts checks it.

export type LocalPortal = 'instructor' | 'student' | 'admin';

/** The port each portal's dev server (`nx dev`) listens on. */
export const LOCAL_PORTAL_PORTS = {
  instructor: 4200,
  student: 4201,
  admin: 4202,
} as const satisfies Record<LocalPortal, number>;

/** The port each portal's preview server (`vite preview`) listens on. */
export const LOCAL_PORTAL_PREVIEW_PORTS = {
  instructor: 4300,
  student: 4301,
  admin: 4302,
} as const satisfies Record<LocalPortal, number>;

const origin = (port: number) => `http://localhost:${port}`;

/** Each portal's dev server origin. */
export const LOCAL_PORTAL_ORIGINS = {
  instructor: origin(LOCAL_PORTAL_PORTS.instructor),
  student: origin(LOCAL_PORTAL_PORTS.student),
  admin: origin(LOCAL_PORTAL_PORTS.admin),
} as const satisfies Record<LocalPortal, string>;

/** Each portal's preview server origin. */
export const LOCAL_PORTAL_PREVIEW_ORIGINS = {
  instructor: origin(LOCAL_PORTAL_PREVIEW_PORTS.instructor),
  student: origin(LOCAL_PORTAL_PREVIEW_PORTS.student),
  admin: origin(LOCAL_PORTAL_PREVIEW_PORTS.admin),
} as const satisfies Record<LocalPortal, string>;

/**
 * Every local origin (dev, then preview) of the given portals, in the order
 * given, for CORS allow-lists and callback URLs.
 */
export const localPortalOrigins = (...portals: LocalPortal[]): string[] =>
  portals.flatMap((portal) => [
    LOCAL_PORTAL_ORIGINS[portal],
    LOCAL_PORTAL_PREVIEW_ORIGINS[portal],
  ]);
