/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { App, Stack, Stage } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { describe, expect, it } from 'vitest';
import { addSetting, pageRendererParameterName } from './settings.js';

const lambda = (stack: Stack) =>
  new Function(stack, 'Fn', {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = () => {}'),
  });

describe('addSetting', { timeout: 30_000 }, () => {
  it('stores a plain object as its JSON', () => {
    const stack = new Stack(new App(), 'Stack');
    const fn = lambda(stack);
    addSetting(fn, 'dynamodb', 'CoreTable', { tableName: 't' });
    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: { DISCAVA_DYNAMODB_CORE_TABLE: '{"tableName":"t"}' },
      },
    });
  });

  it('stores a string as a JSON string', () => {
    const stack = new Stack(new App(), 'Stack');
    addSetting(lambda(stack), 'mediaConvert', 'CaptionLanguageCode', 'en-US');
    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          DISCAVA_MEDIA_CONVERT_CAPTION_LANGUAGE_CODE: '"en-US"',
        },
      },
    });
  });

  it("imports a token from another stack into the function's stack", () => {
    const app = new App();
    const data = new Stack(app, 'Data');
    const param = new StringParameter(data, 'P', { stringValue: 'x' });
    const api = new Stack(app, 'Api');
    addSetting(lambda(api), 'dynamodb', 'CoreTable', {
      tableName: param.parameterName,
    });
    const variable = JSON.stringify(
      Template.fromStack(api).findResources('AWS::Lambda::Function'),
    );
    expect(variable).toContain('Fn::ImportValue');
  });
});

describe('pageRendererParameterName', () => {
  it('is under the stage name', () => {
    const stage = new Stage(new App(), 'discava-development');
    expect(pageRendererParameterName(new Stack(stage, 'Data'))).toBe(
      '/discava-development/page-renderer',
    );
  });
});
