/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { StagesConfig } from './stages.types.js';

// Custom domains and their ACM certificates are account-specific, so they
// aren't committed here. Set them as <STAGE>_INFRA_<COMPONENT>_<FIELD> env vars
// instead (see env-overrides.ts); deploy.yml forwards any such variable set
// on the stage's GitHub environment, and scripts/setup-stage.sh prompts for
// them and sets them there. For discava-development, each component
// takes a DISCAVA_DEVELOPMENT_INFRA_<COMPONENT>_CERTIFICATE_ARN plus:
//
//   APIs (API Gateway; certificate in the stage's region), one domain each,
//   each with a certificate of its own naming exactly that domain -- not a
//   wildcard or one shared with the other API, or browsers can reuse one
//   connection for both APIs and get 403s from the wrong one (#224):
//     DISCAVA_DEVELOPMENT_INFRA_CORE_API_DOMAIN_NAME            api.example.com
//     DISCAVA_DEVELOPMENT_INFRA_INSTRUCTOR_API_DOMAIN_NAME      instructor-api.example.com
//
//   CloudFront (certificate in us-east-1), comma-separated domains:
//     DISCAVA_DEVELOPMENT_INFRA_STUDENT_PORTAL_DOMAIN_NAMES     example.com,www.example.com
//     DISCAVA_DEVELOPMENT_INFRA_INSTRUCTOR_PORTAL_DOMAIN_NAMES  instructor.example.com
//     DISCAVA_DEVELOPMENT_INFRA_ADMIN_PORTAL_DOMAIN_NAMES       admin.example.com
//     DISCAVA_DEVELOPMENT_INFRA_LESSON_MEDIA_DOMAIN_NAMES       lesson-media.example.com
//     DISCAVA_DEVELOPMENT_INFRA_PUBLIC_MEDIA_DOMAIN_NAMES       media.example.com
//
// A domain is only applied when its certificate ARN is also set. Portal
// domains are picked up automatically as API CORS origins and Cognito
// callback/logout URLs. DNS records pointing each domain at its API Gateway /
// CloudFront target aren't managed by the stack and need creating separately.
//
// HLS video playback additionally needs a shared parent domain for signed
// cookies, independent of the certificate/domainNames above:
//     DISCAVA_DEVELOPMENT_INFRA_LESSON_MEDIA_COOKIE_DOMAIN      example.com
export default {
  projects: {
    'packages/infra': {
      stages: {
        // No credentials/region set yet — deploys use your active AWS CLI
        // credentials and CDK_DEFAULT_REGION until these are configured.
        'discava-development': {
          // With WAF off, these limits are what bound the cost of a flood of
          // requests. Sized for a handful of testers:
          // - API Gateway throttles each method separately, so the API's
          //   ceiling is the sum over its methods: core-api 10 x 2 + 2 x 1 =
          //   22 requests/s, instructor-api 33 x 2 = 66. Anonymous callers
          //   reach only the 2 public methods: 2 requests/s in all.
          // - Reserved concurrency caps how many requests each function
          //   runs at once. core-api serves every operation from one
          //   function, and a page fires several queries at once, so not
          //   lower than 10.
          // - The table's maximum throughput caps DynamoDB.
          // - Self sign-up is off, so a bot can't create an account to reach
          //   the signed-in methods; add testers in the Cognito console.
          infra: {
            identity: {
              enableWaf: false,
              enableMfa: false,
              enableDeletionProtection: false,
              retainOnDelete: false,
              enableSelfSignUp: false,
            },
            coreApi: {
              enableWaf: false,
              enableKmsEncryption: false,
              retainOnDelete: false,
              throttleRateLimit: 2,
              throttleBurstLimit: 5,
              publicThrottleRateLimit: 1,
              publicThrottleBurstLimit: 3,
              reservedConcurrency: 10,
              timeoutSeconds: 10,
              logLevel: 'WARN',
              enableTracing: false,
            },
            instructorApi: {
              enableWaf: false,
              enableKmsEncryption: false,
              retainOnDelete: false,
              throttleRateLimit: 2,
              throttleBurstLimit: 5,
              reservedConcurrency: 10,
              logLevel: 'WARN',
              enableTracing: false,
            },
            coreTable: {
              enableKmsEncryption: false,
              enableDeletionProtection: false,
              retainOnDelete: false,
              maxReadRequestUnits: 100,
              maxWriteRequestUnits: 50,
            },
            studentPortal: { enableWaf: false, enableKmsEncryption: false },
            instructorPortal: { enableWaf: false, enableKmsEncryption: false },
            adminPortal: { enableWaf: false, enableKmsEncryption: false },
            lessonMedia: {
              enableWaf: false,
              enableKmsEncryption: false,
              retainOnDelete: false,
            },
            publicMedia: {
              enableWaf: false,
              enableKmsEncryption: false,
              retainOnDelete: false,
            },
            search: {
              enableKmsEncryption: false,
              standbyReplicas: false,
              retainOnDelete: false,
            },
          },
        },
        'discava-production': {
          // Limits with room for real traffic, still well short of AWS's
          // defaults (10,000 requests/s, unbounded concurrency and
          // throughput). Throttles apply to each method separately: ceilings
          // of about 540 requests/s for core-api and 660 for instructor-api.
          // Raise them as usage grows.
          infra: {
            identity: {
              enableWaf: true,
              enableMfa: true,
              enableDeletionProtection: true,
              retainOnDelete: true,
              enableSelfSignUp: true,
            },
            coreApi: {
              enableWaf: true,
              enableKmsEncryption: true,
              enableKeyRotation: true,
              retainOnDelete: true,
              throttleRateLimit: 50,
              throttleBurstLimit: 100,
              publicThrottleRateLimit: 20,
              publicThrottleBurstLimit: 40,
              reservedConcurrency: 50,
              timeoutSeconds: 10,
              logLevel: 'INFO',
              enableTracing: true,
            },
            instructorApi: {
              enableWaf: true,
              enableKmsEncryption: true,
              enableKeyRotation: true,
              retainOnDelete: true,
              throttleRateLimit: 20,
              throttleBurstLimit: 50,
              reservedConcurrency: 25,
              logLevel: 'INFO',
              enableTracing: true,
            },
            coreTable: {
              enableKmsEncryption: true,
              enableKeyRotation: true,
              enableDeletionProtection: true,
              retainOnDelete: true,
              maxReadRequestUnits: 4000,
              maxWriteRequestUnits: 2000,
            },
            studentPortal: {
              enableWaf: true,
              enableKmsEncryption: true,
              enableKeyRotation: true,
            },
            instructorPortal: {
              enableWaf: true,
              enableKmsEncryption: true,
              enableKeyRotation: true,
            },
            adminPortal: {
              enableWaf: true,
              enableKmsEncryption: true,
              enableKeyRotation: true,
            },
            lessonMedia: {
              enableWaf: true,
              enableKmsEncryption: true,
              enableKeyRotation: true,
              retainOnDelete: true,
            },
            publicMedia: {
              enableWaf: true,
              enableKmsEncryption: true,
              enableKeyRotation: true,
              retainOnDelete: true,
            },
            search: {
              enableKmsEncryption: true,
              enableKeyRotation: true,
              standbyReplicas: true,
              retainOnDelete: true,
            },
          },
        },
      },
    },
  },
  shared: {
    stages: {
      // Example: shared sandbox stage available to all projects
      // 'sandbox': {
      //   credentials: { type: 'profile', profile: 'sandbox-profile' },
      //   region: 'us-east-1',
      // },
    },
  },
} as const satisfies StagesConfig;
