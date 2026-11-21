/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { synth, tableFunctionsMissingAppConfig } from './stack-test-fixture.js';

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

describe('runtime config (#619)', () => {
  it('gives every function that uses the core table the AppConfig application id and read access', () => {
    expect(tableFunctionsMissingAppConfig(synth({})('StreamRouter'))).toEqual(
      [],
    );
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
