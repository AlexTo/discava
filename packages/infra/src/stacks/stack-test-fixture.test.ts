/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  functionsMissingNamedSettings,
  functionsMissingSettings,
  functionsReadingAppConfig,
} from './stack-test-fixture.js';

const fn = (role: string, variables?: Record<string, string>) => ({
  Type: 'AWS::Lambda::Function',
  Properties: {
    Role: { 'Fn::GetAtt': [role, 'Arn'] },
    ...(variables && { Environment: { Variables: variables } }),
  },
});

const policy = (role: string, action: string) => ({
  Type: 'AWS::IAM::Policy',
  Properties: {
    PolicyDocument: { Statement: [{ Action: action, Effect: 'Allow' }] },
    Roles: [{ Ref: role }],
  },
});

const TABLE = { DISCAVA_DYNAMODB_CORE_TABLE: '{"tableName":"t"}' };
const SEARCH = { DISCAVA_OPENSEARCH_SEARCH: '{"endpoint":"e"}' };

describe('functionsMissingSettings', () => {
  const template = Template.fromJSON({
    Resources: {
      TableOkFn: fn('TableOkRole', TABLE),
      TableOkPolicy: policy('TableOkRole', 'dynamodb:GetItem'),
      TableMissingFn: fn('TableMissingRole', {}),
      TableMissingPolicy: policy('TableMissingRole', 'dynamodb:Query'),
      SearchOkFn: fn('SearchOkRole', SEARCH),
      SearchOkPolicy: policy('SearchOkRole', 'aoss:APIAccessAll'),
      SearchMissingFn: fn('SearchMissingRole'),
      SearchMissingPolicy: policy('SearchMissingRole', 'aoss:APIAccessAll'),
      StreamOnlyFn: fn('StreamRole'),
      StreamOnlyPolicy: policy('StreamRole', 'dynamodb:GetRecords'),
    },
  });

  it('names the functions that can use the table or search without the setting', () => {
    expect(functionsMissingSettings(template).sort()).toEqual([
      'SearchMissingFn',
      'TableMissingFn',
    ]);
  });
});

describe('functionsMissingNamedSettings', () => {
  const template = Template.fromJSON({
    Resources: {
      AlphaFn1: fn('R', { DISCAVA_S3_A: '{}', DISCAVA_S3_B: '{}' }),
      BetaFn1: fn('R', { DISCAVA_S3_A: '{}' }),
    },
  });

  it('names each function lacking a required setting, and prefixes matching nothing', () => {
    expect(
      functionsMissingNamedSettings(template, {
        AlphaFn: ['DISCAVA_S3_A', 'DISCAVA_S3_B'],
        BetaFn: ['DISCAVA_S3_A', 'DISCAVA_S3_B'],
        GammaFn: ['DISCAVA_S3_A'],
      }),
    ).toEqual(['BetaFn1: DISCAVA_S3_B', 'GammaFn: no such function']);
  });
});

describe('functionsReadingAppConfig', () => {
  const template = Template.fromJSON({
    Resources: {
      ByVariableFn: fn('RoleA', { RUNTIME_CONFIG_APP_ID: 'app' }),
      ByActionFn: fn('RoleB', {}),
      ByActionPolicy: policy('RoleB', 'appconfig:GetLatestConfiguration'),
      CleanFn: fn('RoleC', TABLE),
      CleanPolicy: policy('RoleC', 'dynamodb:GetItem'),
    },
  });

  it('names the functions with the application id or an appconfig action', () => {
    expect(functionsReadingAppConfig(template).sort()).toEqual([
      'ByActionFn',
      'ByVariableFn',
    ]);
  });
});
