/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { synth } from './stack-test-fixture.js';

describe('the media pipeline’s safety nets (#125, #185)', () => {
  const media = synth({})('MediaPipeline');
  const functionIdOf = (prefix: string) =>
    Object.keys(media.findResources('AWS::Lambda::Function')).find((id) =>
      id.startsWith(prefix),
    )!;

  it.each(['TranscodeComplete', 'TranscodeCleanup'])(
    'keeps events %s keeps failing in a queue',
    (name) => {
      media.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
        FunctionName: { Ref: functionIdOf(name) },
        MaximumRetryAttempts: 2,
        DestinationConfig: {
          OnFailure: {
            Destination: {
              'Fn::GetAtt': [Match.stringLikeRegexp(`^${name}Failures`), 'Arn'],
            },
          },
        },
      });
    },
  );

  it('keeps MediaConvert events EventBridge couldn’t deliver', () => {
    media.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ source: ['aws.mediaconvert'] }),
      Targets: [
        Match.objectLike({
          DeadLetterConfig: {
            Arn: {
              'Fn::GetAtt': [
                Match.stringLikeRegexp('^TranscodeCompleteFailures'),
                'Arn',
              ],
            },
          },
        }),
      ],
    });
  });

  it('reconciles stuck videos every 30 minutes, asking MediaConvert about their jobs', () => {
    media.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(30 minutes)',
      Targets: [
        Match.objectLike({
          Arn: {
            'Fn::GetAtt': [functionIdOf('TranscodeReconciler'), 'Arn'],
          },
        }),
      ],
    });
    media.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'mediaconvert:GetJob' }),
        ]),
      },
      Roles: [
        { Ref: Match.stringLikeRegexp('^TranscodeReconcilerServiceRole') },
      ],
    });
  });
});

describe('automatic captions (US4)', () => {
  const media = synth({})('MediaPipeline');
  const functionIdOf = (prefix: string) =>
    Object.keys(media.findResources('AWS::Lambda::Function')).find((id) =>
      id.startsWith(prefix),
    )!;
  const statementsFor = (rolePrefix: string) =>
    Object.values(media.findResources('AWS::IAM::Policy'))
      .filter((policy) =>
        (
          policy as { Properties: { Roles: { Ref: string }[] } }
        ).Properties.Roles.some(({ Ref }) => Ref.startsWith(rolePrefix)),
      )
      .flatMap(
        (policy) =>
          (
            policy as {
              Properties: {
                PolicyDocument: {
                  Statement: { Action: string | string[]; Resource: unknown }[];
                };
              };
            }
          ).Properties.PolicyDocument.Statement,
      );
  const allows = (rolePrefix: string, action: string, resource?: string) =>
    statementsFor(rolePrefix).some(
      (s) =>
        [s.Action].flat().some((a) => a === action) &&
        (resource === undefined ||
          JSON.stringify(s.Resource).includes(resource)),
    );

  it('routes Transcribe completions and failures to its own Lambda, keeping what it fails on', () => {
    media.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.transcribe'],
        'detail-type': ['Transcribe Job State Change'],
        detail: { TranscriptionJobStatus: ['COMPLETED', 'FAILED'] },
      },
      Targets: [
        Match.objectLike({
          Arn: { 'Fn::GetAtt': [functionIdOf('TranscribeComplete'), 'Arn'] },
          DeadLetterConfig: {
            Arn: {
              'Fn::GetAtt': [
                Match.stringLikeRegexp('^TranscribeCompleteFailures'),
                'Arn',
              ],
            },
          },
        }),
      ],
    });
    media.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
      FunctionName: { Ref: functionIdOf('TranscribeComplete') },
      MaximumRetryAttempts: 2,
    });
  });

  it('lets transcribe-complete read the job, use the table, and move the WebVTT into captions only', () => {
    const role = 'TranscribeCompleteServiceRole';
    expect(allows(role, 'transcribe:GetTranscriptionJob')).toBe(true);
    expect(allows(role, 'dynamodb:PutItem')).toBe(true);
    expect(
      allows(role, 's3:DeleteObject*', '/courses/*/transcribe-output/*'),
    ).toBe(true);
    expect(
      allows(role, 's3:GetObject*', '/courses/*/transcribe-output/*'),
    ).toBe(true);
    expect(allows(role, 's3:PutObject', '/courses/*/captions/*')).toBe(true);
    expect(allows(role, 's3:PutObject', '/courses/*/transcribe-output/*')).toBe(
      false,
    );
  });

  it.each(['TranscodeComplete', 'TranscodeReconciler'])(
    'lets %s start Transcribe jobs, read the audio file and write the scratch prefix only',
    (name) => {
      const role = `${name}ServiceRole`;
      expect(allows(role, 'transcribe:StartTranscriptionJob')).toBe(true);
      expect(allows(role, 'transcribe:TagResource')).toBe(true);
      expect(allows(role, 's3:GetObject*', '/transcribe-input/*')).toBe(true);
      expect(
        allows(role, 's3:PutObject', '/courses/*/transcribe-output/*'),
      ).toBe(true);
      expect(allows(role, 's3:PutObject', '/courses/*/captions/*')).toBe(false);
    },
  );
});
