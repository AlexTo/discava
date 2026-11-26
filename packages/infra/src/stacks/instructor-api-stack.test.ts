/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  functionsMissingNamedSettings,
  functionsReadingAppConfig,
  synth,
} from './stack-test-fixture.js';

describe('course images (#76)', () => {
  const stack = synth({});

  // Actions on the public media bucket, per instructor-api function.
  const publicMediaActions = () => {
    const template = stack('InstructorApi');
    const roles = Object.fromEntries(
      Object.entries(template.findResources('AWS::Lambda::Function')).map(
        ([id, fn]) => [
          JSON.stringify(
            (fn as { Properties: { Role: unknown } }).Properties.Role,
          ),
          id,
        ],
      ),
    );
    const actions: Record<string, string[]> = {};
    for (const policy of Object.values(
      template.findResources('AWS::IAM::Policy'),
    ) as {
      Properties: {
        Roles: { Ref: string }[];
        PolicyDocument: {
          Statement: { Action: string | string[]; Resource: unknown }[];
        };
      };
    }[]) {
      const fn =
        roles[
          JSON.stringify({
            'Fn::GetAtt': [policy.Properties.Roles[0].Ref, 'Arn'],
          })
        ];
      for (const statement of policy.Properties.PolicyDocument.Statement) {
        if (JSON.stringify(statement.Resource).includes('PublicMediaBucket')) {
          (actions[fn] ??= []).push(...[statement.Action].flat());
        }
      }
    }
    return actions;
  };

  it('lets only the course image function upload and tag images', () => {
    const actions = publicMediaActions();

    expect(Object.keys(actions)).toEqual([
      expect.stringMatching(/^InstructorApiCourseImageHandler/),
    ]);
    expect(Object.values(actions)[0]).toEqual(
      expect.arrayContaining([
        's3:PutObject',
        's3:PutObjectTagging',
        's3:DeleteObjectTagging',
      ]),
    );
  });

  it.each(['StudentPortal', 'InstructorPortal'])(
    'lets the %s show them, and the crop preview',
    (portal) => {
      const policies = Object.entries(
        stack('Websites').findResources(
          'AWS::CloudFront::ResponseHeadersPolicy',
        ),
      )
        .filter(([id]) => id.startsWith(portal))
        .map(
          ([, policy]) =>
            (
              policy as {
                Properties: {
                  ResponseHeadersPolicyConfig: {
                    SecurityHeadersConfig: {
                      ContentSecurityPolicy: { ContentSecurityPolicy: string };
                    };
                  };
                };
              }
            ).Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig
              .ContentSecurityPolicy.ContentSecurityPolicy,
        );

      expect(policies).toHaveLength(1);
      const directives = Object.fromEntries(
        policies[0].split('; ').map((d) => [d.split(' ')[0], d]),
      );
      expect(directives['img-src']).toBe("img-src 'self' data: blob: https:");
      // Scripts stay limited to the portal itself.
      expect(directives['script-src']).toBe("script-src 'self'");
    },
  );

  it('serves images without signing', () => {
    const distributions = Object.entries(
      stack('Data').findResources('AWS::CloudFront::Distribution'),
    ).filter(([id]) => id.startsWith('PublicMediaBucket'));

    expect(distributions).toHaveLength(1);
    expect(
      JSON.stringify(distributions[0][1]).includes('TrustedKeyGroups'),
    ).toBe(false);
  });
});

describe('deploy-time settings per function', () => {
  const template = synth({})('InstructorApi');
  // Function logical-ID prefix to the settings its code reads.
  const required = {
    InstructorApiRouterHandler: [
      'DISCAVA_DYNAMODB_CORE_TABLE_TABLE_NAME',
      'DISCAVA_CAPTION_TRANSLATION_SETTINGS_ENABLED',
    ],
    InstructorApiMediaUrlHandler: [
      'DISCAVA_DYNAMODB_CORE_TABLE_TABLE_NAME',
      'DISCAVA_S3_LESSON_MEDIA_BUCKET_BUCKET_NAME',
      'DISCAVA_CAPTION_TRANSLATION_SETTINGS_ENABLED',
    ],
    InstructorApiCourseImageHandler: [
      'DISCAVA_DYNAMODB_CORE_TABLE_TABLE_NAME',
      'DISCAVA_S3_PUBLIC_MEDIA_BUCKET_BUCKET_NAME',
    ],
    InstructorApiMediaHandler: [
      'DISCAVA_DYNAMODB_CORE_TABLE_TABLE_NAME',
      'DISCAVA_S3_LESSON_MEDIA_BUCKET_BUCKET_NAME',
      'DISCAVA_S3_LESSON_MEDIA_UPLOAD_BUCKET_BUCKET_NAME',
      'DISCAVA_MEDIA_CONVERT_VIDEO_TRANSCODE_PIPELINE_ROLE_ARN',
      'DISCAVA_MEDIA_CONVERT_TRANSCODE_CLEANUP_LAMBDA_ARN',
    ],
    InstructorApiPayoutsHandler: ['DISCAVA_DYNAMODB_CORE_TABLE_TABLE_NAME'],
  };

  it('gives each function the settings its code reads', () => {
    expect(functionsMissingNamedSettings(template, required)).toEqual([]);
  });

  it('leaves no function able to read AppConfig', () => {
    expect(functionsReadingAppConfig(template)).toEqual([]);
  });
});

describe('caption languages (#755)', () => {
  // The router reports and enforces the languages; the media URL function
  // reports each video's translation status (#914).
  it.each(['InstructorApiRouterHandler', 'InstructorApiMediaUrlHandler'])(
    'hands %s the stage settings it was given, and the defaults without any',
    (handler) => {
      const setting = (components: Parameters<typeof synth>[0]) =>
        Object.entries(
          synth(components)('InstructorApi').findResources(
            'AWS::Lambda::Function',
          ),
        )
          .filter(([id]) => id.startsWith(handler))
          .map(([, fn]) => {
            const variables = fn.Properties.Environment.Variables;
            return `${variables.DISCAVA_CAPTION_TRANSLATION_SETTINGS_ENABLED}/${variables.DISCAVA_CAPTION_TRANSLATION_SETTINGS_MAX_LANGUAGES_PER_COURSE}`;
          })
          .filter((value, index, all) => all.indexOf(value) === index);
      expect(
        setting({ captionTranslation: { maxLanguagesPerCourse: 3 } }),
      ).toEqual(['true/3']);
      expect(setting({ captionTranslation: { enabled: false } })).toEqual([
        'false/9',
      ]);
      expect(setting({})).toEqual(['true/9']);
    },
  );
});
