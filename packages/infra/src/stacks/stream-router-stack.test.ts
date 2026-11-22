/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  functionsMissingNamedSettings,
  functionsMissingSettings,
  functionsReadingAppConfig,
  synth,
} from './stack-test-fixture.js';

describe('search indexing (#53)', () => {
  const stack = synth({});

  // It re-reads each changed course from the table (R-3), so it reads the
  // table, and still never writes it.
  it('gives the indexing function write access to the search collection, and read-only access to the core table', () => {
    const template = stack('StreamRouter');
    const policies = Object.values(
      template.findResources('AWS::IAM::Policy', {
        Properties: {
          Roles: [
            { Ref: Match.stringLikeRegexp('^SearchIndexingServiceRole') },
          ],
        },
      }),
    ) as {
      Properties: {
        PolicyDocument: { Statement: { Action: string | string[] }[] };
      };
    }[];
    const actions = policies.flatMap((policy) =>
      policy.Properties.PolicyDocument.Statement.flatMap((statement) =>
        [statement.Action].flat(),
      ),
    );

    expect(actions).toContain('aoss:APIAccessAll');
    expect(actions).toContain('dynamodb:GetRecords');
    expect(actions).toContain('dynamodb:GetItem');
    expect(actions).not.toContain('dynamodb:PutItem');
    expect(actions).not.toContain('dynamodb:UpdateItem');
    expect(actions).not.toContain('dynamodb:DeleteItem');
  });
});

describe('transcript indexing', () => {
  const template = synth({})('StreamRouter');
  const statements = Object.values(
    template.findResources('AWS::IAM::Policy', {
      Properties: {
        Roles: [
          { Ref: Match.stringLikeRegexp('^TranscriptIndexingServiceRole') },
        ],
      },
    }),
  ).flatMap(
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
  const actions = statements.flatMap((statement) => [statement.Action].flat());

  // It reads the table (the item, its lesson and module) and the caption
  // files, and writes only the search collection.
  it('lets the function read the table and the lesson media bucket, write the search collection, and write no table item', () => {
    expect(actions).toContain('dynamodb:GetItem');
    expect(actions).toContain('s3:GetObject*');
    expect(actions).toContain('aoss:APIAccessAll');
    for (const action of [
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
      'dynamodb:BatchWriteItem',
    ]) {
      expect(actions).not.toContain(action);
    }
  });

  it('does not let the function write or delete caption files', () => {
    expect(
      actions.filter((action) => /^s3:(Put|Delete|Abort)/.test(action)),
    ).toEqual([]);
  });

  it('has a function, a queue, a failure queue and an alarm for the feature', () => {
    expect(
      Object.keys(template.findResources('AWS::Lambda::Function')).some((id) =>
        id.startsWith('TranscriptIndexing'),
      ),
    ).toBe(true);
    const queues = JSON.stringify(template.findResources('AWS::SQS::Queue'));
    expect(queues).toContain('TranscriptIndexing');
  });
});

describe('deploy-time settings', () => {
  it('gives every function that uses the core table or search its setting', () => {
    expect(functionsMissingSettings(synth({})('StreamRouter'))).toEqual([]);
  });
});

describe('certificate reminder', () => {
  const stack = synth({});
  const template = () => stack('StreamRouter');
  const statements = (rolePrefix: string) =>
    Object.values(template().findResources('AWS::IAM::Policy'))
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
                PolicyDocument: { Statement: Record<string, unknown>[] };
              };
            }
          ).Properties.PolicyDocument.Statement,
      );

  it('has a schedule group that is destroyed with the stack', () => {
    template().hasResource('AWS::Scheduler::ScheduleGroup', {
      DeletionPolicy: 'Delete',
    });
    expect(
      Object.keys(template().findResources('AWS::Scheduler::ScheduleGroup')),
    ).toEqual([expect.stringMatching(/^CertificateReminderGroup/)]);
  });

  it('lets only EventBridge Scheduler assume the scheduler role, to invoke the reminder Lambda and nothing else', () => {
    template().hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'scheduler.amazonaws.com' },
          }),
        ],
      },
    });
    const invokes = statements('CertificateReminderSchedulerRole');
    expect(invokes).toHaveLength(1);
    expect(invokes[0]).toMatchObject({ Action: 'lambda:InvokeFunction' });
    expect(JSON.stringify(invokes[0]?.Resource)).toContain(
      'CertificateReminder',
    );
  });

  it('lets the recalculation Lambda write schedules in that group and pass only that role to Scheduler', () => {
    const recalculation = statements('ProgressRecalculationServiceRole');
    const schedule = recalculation.find(
      ({ Action }) =>
        Array.isArray(Action) && Action.includes('scheduler:CreateSchedule'),
    );
    expect(JSON.stringify(schedule?.Resource)).toContain(
      'CertificateReminderGroup',
    );
    const pass = recalculation.find(({ Action }) => Action === 'iam:PassRole');
    expect(pass).toMatchObject({
      Condition: {
        StringEquals: { 'iam:PassedToService': 'scheduler.amazonaws.com' },
      },
    });
    expect(JSON.stringify(pass?.Resource)).toContain(
      'CertificateReminderSchedulerRole',
    );
  });

  it('retries twice, for six hours, then keeps the failure in a queue', () => {
    template().hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
      MaximumRetryAttempts: 2,
      MaximumEventAgeInSeconds: 21600,
      DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
    });
    template().hasResourceProperties('AWS::SQS::Queue', {
      SqsManagedSseEnabled: true,
    });
    expect(
      Object.keys(template().findResources('AWS::SQS::Queue')).some((id) =>
        id.startsWith('CertificateReminderFailures'),
      ),
    ).toBe(true);
  });

  it('reads and writes the table and sends no email', () => {
    const actions = statements('CertificateReminderServiceRole').flatMap(
      ({ Action }) => [Action as string | string[]].flat(),
    );
    expect(actions).toContain('dynamodb:PutItem');
    expect(actions.some((action) => action.startsWith('ses:'))).toBe(false);
  });
});

describe('caption translation', () => {
  it('hands the function the settings it was given, and the defaults without any', () => {
    const setting = (components: Parameters<typeof synth>[0]) =>
      JSON.stringify(
        Object.entries(
          synth(components)('StreamRouter').findResources(
            'AWS::Lambda::Function',
          ),
        )
          .filter(([id]) => id.startsWith('CaptionTranslation'))
          .map(
            ([, fn]) =>
              fn.Properties.Environment.Variables
                .DISCAVA_CAPTION_TRANSLATION_SETTINGS,
          ),
      );
    expect(
      setting({ captionTranslation: { maxLanguagesPerCourse: 3 } }),
    ).toMatch(/maxLanguagesPerCourse[\s\S]*3/);
    expect(setting({})).toMatch(/maxLanguagesPerCourse[\s\S]*9/);
  });

  const stack = synth({});
  const template = () => stack('StreamRouter');
  const statements = () =>
    Object.values(template().findResources('AWS::IAM::Policy'))
      .filter((policy) =>
        (
          policy as { Properties: { Roles: { Ref: string }[] } }
        ).Properties.Roles.some(({ Ref }) =>
          Ref.startsWith('CaptionTranslationServiceRole'),
        ),
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
  const actions = () => statements().flatMap(({ Action }) => [Action].flat());

  it('allows Amazon Translate and nothing of Comprehend, Transcribe or MediaConvert', () => {
    expect(actions()).toContain('translate:TranslateText');
    for (const prefix of ['comprehend:', 'transcribe:', 'mediaconvert:']) {
      expect(actions().some((action) => action.startsWith(prefix))).toBe(false);
    }
  });

  it('allows S3 object actions only on the captions pattern', () => {
    const s3 = statements().filter(({ Action }) =>
      [Action].flat().some((action) => action.startsWith('s3:')),
    );
    expect(s3.length).toBeGreaterThan(0);
    const objectResources = s3
      .flatMap(({ Resource }) => [Resource].flat())
      .map((resource) => JSON.stringify(resource))
      .filter((resource) => resource.includes('/'));
    expect(objectResources.length).toBeGreaterThan(0);
    for (const resource of objectResources) {
      expect(resource).toContain('courses/*/captions/*');
    }
    const s3Actions = s3.flatMap(({ Action }) => [Action].flat());
    expect(s3Actions).toEqual(
      expect.arrayContaining(['s3:PutObject', 's3:DeleteObject*']),
    );
  });

  it('has the feature queue, its failure queue and its alarm', () => {
    const ids = (type: string) => Object.keys(template().findResources(type));
    const queues = ids('AWS::SQS::Queue');
    expect(queues.some((id) => id.includes('CaptionTranslationQueue'))).toBe(
      true,
    );
    expect(queues.some((id) => id.includes('CaptionTranslationFailures'))).toBe(
      true,
    );
    expect(
      ids('AWS::CloudWatch::Alarm').some((id) =>
        id.includes('CaptionTranslationFailuresAlarm'),
      ),
    ).toBe(true);
  });

  it('sets the stage name in the function environment', () => {
    template().hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: { STAGE_NAME: 'discava-test' },
      },
      Timeout: 900,
    });
  });
});

describe('brand publishing', () => {
  const template = synth({})('StreamRouter');
  const brandRole = () => {
    const fn = Object.values(
      template.findResources('AWS::Lambda::Function'),
    ).find((resource) =>
      JSON.stringify(resource.Properties.Environment ?? {}).includes(
        'DISCAVA_S3_PUBLIC_MEDIA_BUCKET',
      ),
    );
    return (fn?.Properties.Role as { 'Fn::GetAtt': string[] })[
      'Fn::GetAtt'
    ][0] as string;
  };
  const statements = () =>
    Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((policy) =>
        (
          policy as { Properties: { Roles: { Ref: string }[] } }
        ).Properties.Roles.some(({ Ref }) => Ref === brandRole()),
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

  it('has a function, a queue, a failure queue and an alarm for the feature', () => {
    const ids = (type: string) => Object.keys(template.findResources(type));
    expect(
      ids('AWS::Lambda::Function').some((id) =>
        id.startsWith('BrandPublishing'),
      ),
    ).toBe(true);
    expect(
      ids('AWS::SQS::Queue').some((id) => id.includes('BrandPublishingQueue')),
    ).toBe(true);
    expect(
      ids('AWS::SQS::Queue').some((id) =>
        id.includes('BrandPublishingFailures'),
      ),
    ).toBe(true);
    expect(
      ids('AWS::CloudWatch::Alarm').some((id) =>
        id.includes('BrandPublishingFailuresAlarm'),
      ),
    ).toBe(true);
  });

  it('is passed to the stream router for the brand-publishing feature', () => {
    expect(JSON.stringify(template.toJSON())).toContain('brand-publishing');
  });

  it('can put brand/brand.json and nothing else in the bucket', () => {
    const s3 = statements().filter(({ Action }) =>
      [Action].flat().some((action) => action.startsWith('s3:')),
    );
    const writes = s3.filter(({ Action }) =>
      [Action].flat().some((action) => action.startsWith('s3:Put')),
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const { Resource } of writes) {
      expect(JSON.stringify(Resource)).toContain('/brand/brand.json');
    }
    for (const { Action } of s3) {
      for (const action of [Action].flat()) {
        expect(action).not.toMatch(/^s3:(Delete|GetObject|List)/);
      }
    }
  });

  it('may use the bucket key to write, and the table only to read', () => {
    const actions = statements().flatMap(({ Action }) => [Action].flat());
    expect(actions.some((action) => action.startsWith('kms:'))).toBe(true);
    expect(actions).not.toContain('dynamodb:PutItem');
    expect(actions).not.toContain('dynamodb:UpdateItem');
  });
});

describe('deploy-time settings per function', () => {
  const template = synth({})('StreamRouter');
  // Function logical-ID prefix to the settings its code reads.
  const required = {
    CertificateReminder: ['DISCAVA_DYNAMODB_CORE_TABLE'],
    ProgressRecalculation: [
      'DISCAVA_DYNAMODB_CORE_TABLE',
      'DISCAVA_CERTIFICATES_REMINDER',
    ],
    SearchIndexing: [
      'DISCAVA_DYNAMODB_CORE_TABLE',
      'DISCAVA_OPENSEARCH_SEARCH',
    ],
    TranscriptIndexing: [
      'DISCAVA_DYNAMODB_CORE_TABLE',
      'DISCAVA_OPENSEARCH_SEARCH',
      'DISCAVA_S3_LESSON_MEDIA_BUCKET',
    ],
    AnalyticsUpdate: ['DISCAVA_DYNAMODB_CORE_TABLE'],
    NotificationDelivery: ['DISCAVA_DYNAMODB_CORE_TABLE'],
    EarningsRecording: ['DISCAVA_DYNAMODB_CORE_TABLE'],
    BrandPublishing: [
      'DISCAVA_DYNAMODB_CORE_TABLE',
      'DISCAVA_S3_PUBLIC_MEDIA_BUCKET',
    ],
    CaptionTranslation: [
      'DISCAVA_DYNAMODB_CORE_TABLE',
      'DISCAVA_S3_LESSON_MEDIA_BUCKET',
      'DISCAVA_CAPTION_TRANSLATION_SETTINGS',
    ],
  };

  it('gives each function the settings its code reads', () => {
    expect(functionsMissingNamedSettings(template, required)).toEqual([]);
  });

  it('leaves no function able to read AppConfig', () => {
    expect(functionsReadingAppConfig(template)).toEqual([]);
  });
});
