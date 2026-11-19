/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LOCAL_PORTAL_ORIGINS } from '@discava/common-infra-config/local-portals';

// Where `pnpm dev` serves the portals (from common-infra-config).
export const PORTALS = LOCAL_PORTAL_ORIGINS;

// What else must answer before a scenario can run: the APIs, the event runner
// and the local stand-ins for S3 and Cognito (see common-server-utils'
// local-dev for their ports).
export const SERVICES = {
  coreApi: 'http://localhost:2022/',
  instructorApi: 'http://localhost:2023/',
  adminApi: 'http://localhost:2025/',
  eventRunner: 'http://localhost:2024/',
  s3Mock: 'http://localhost:9090/',
  localOidc: 'http://localhost:9400/discava/.well-known/openid-configuration',
  // The local OpenSearch container's `courses` index (port from
  // @discava/search's config.json). global-setup waits for it to exist (200),
  // not just for the container to answer (#267).
  searchIndex: 'http://localhost:9200/courses',
} as const;
