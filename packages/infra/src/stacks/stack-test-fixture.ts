/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// Shared by the stage test and each stack's test: one way to synthesise the
// application and read the templates of its stacks.
import { type StageComponents } from '@discava/common-infra-config';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ApplicationStage } from '../stages/application-stage.js';

// Synthesizes the application with a stage's settings and returns each of
// its stacks' templates.
export const synth = (components: StageComponents) => {
  const stage = new ApplicationStage(new App(), 'discava-test', {
    env: { account: '111122223333', region: 'ap-southeast-2' },
    ...components,
  });
  return (name: string) =>
    Template.fromStack(stage.node.findChild(name) as Stack);
};

// The resources of `type` whose logical id starts with one of `prefixes`.
export const resources = (
  template: Template,
  type: string,
  ...prefixes: string[]
): Record<string, unknown>[] =>
  Object.entries(template.findResources(type))
    .filter(([id]) => prefixes.some((prefix) => id.startsWith(prefix)))
    .map(
      ([, resource]) =>
        (resource as { Properties: Record<string, unknown> }).Properties,
    );

export const methodSettings = (template: Template) =>
  Object.values(template.findResources('AWS::ApiGateway::Stage')).flatMap(
    (stage) =>
      (stage as { Properties: { MethodSettings?: object[] } }).Properties
        .MethodSettings ?? [],
  );

// The actions each role of a stack's template is allowed, by the role's
// logical id's prefix.
export const actionsByRole = (template: Template) => {
  const byRole: Record<string, string[]> = {};
  for (const resource of Object.values(
    template.findResources('AWS::IAM::Policy'),
  )) {
    const { PolicyDocument, Roles } = (
      resource as {
        Properties: {
          PolicyDocument: { Statement: { Action: string | string[] }[] };
          Roles: { Ref: string }[];
        };
      }
    ).Properties;
    const actions = PolicyDocument.Statement.flatMap((s) => [s.Action].flat());
    for (const role of Roles) {
      byRole[role.Ref] = [...(byRole[role.Ref] ?? []), ...actions];
    }
  }
  return byRole;
};

export const actionsOf = (template: Template, rolePrefix: string) =>
  Object.entries(actionsByRole(template))
    .filter(([role]) => role.startsWith(rolePrefix))
    .flatMap(([, actions]) => actions);

// Every stack in the stage, by name, with its synthesized template.
export const stackTemplates = (components: StageComponents) => {
  const stage = new ApplicationStage(new App(), 'discava-test', {
    env: { account: '111122223333', region: 'ap-southeast-2' },
    ...components,
  });
  return stage.node.children
    .filter((child): child is Stack => child instanceof Stack)
    .map((child) => [child.node.id, Template.fromStack(child)] as const);
};
