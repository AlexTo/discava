/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { synth } from './stack-test-fixture.js';

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
