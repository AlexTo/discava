/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LOCAL_PORTAL_ORIGINS } from '@discava/common-infra-config/local-portals';

/**
 * Local dev's whole runtime config: everything runs locally (#137), so there's
 * no deployed stack's runtime-config.json to fetch.
 */
export const LOCAL_DEV_CONFIG = {
  // Sign in with the local OIDC server instead of Cognito (#226; port, issuer
  // and client from tooling-local-dev's local-oidc/config.json).
  localOidc: {
    authority: 'http://localhost:9400/discava',
    clientId: 'local',
  },
  // Where `pnpm dev` serves each portal, as the deployed config has their
  // addresses (#235).
  portals: {
    StudentPortal: LOCAL_PORTAL_ORIGINS.student,
    InstructorPortal: LOCAL_PORTAL_ORIGINS.instructor,
    AdminPortal: LOCAL_PORTAL_ORIGINS.admin,
  },
  // The issuer a certificate names when it's added to LinkedIn.
  site: { name: 'Discava' },
  apis: {
    CoreApi: 'http://localhost:2022/',
  },
  // Course images come from S3Mock, which stands in for S3 in local dev
  // (#137; port and bucket from common-server-utils' LOCAL_S3).
  media: {
    PublicMediaBucket: 'http://localhost:9090/discava-public-media/',
  },
};
