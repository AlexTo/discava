/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node

import { Match } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { synth } from './stack-test-fixture.js';

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
