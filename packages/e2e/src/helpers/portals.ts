/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Where `pnpm dev` serves the portals (their project.json ports).
export const PORTALS = {
  instructor: 'http://localhost:4200',
  student: 'http://localhost:4201',
  admin: 'http://localhost:4202',
} as const;

// What else must answer before a scenario can run: the APIs, the event runner
// and the local stand-ins for S3 and Cognito (see common-server-utils'
// local-dev for their ports).
export const SERVICES = {
  coreApi: 'http://localhost:2022/',
  instructorApi: 'http://localhost:2023/',
  eventRunner: 'http://localhost:2024/',
  s3Mock: 'http://localhost:9090/',
  localOidc: 'http://localhost:9400/discava/.well-known/openid-configuration',
} as const;
