/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// Shared by the stage test and each stack's test: one way to synthesise the
// application and read the templates of its stacks.
import { type StageComponents } from '@discava/common-infra-config';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  ApplicationStage,
  type ApplicationStageProps,
} from '../stages/application-stage.js';

// Synthesizes the application with a stage's settings and returns each of
// its stacks' templates.
export const synth = (
  components: StageComponents &
    Pick<ApplicationStageProps, 'payouts' | 'captionTranslation'>,
) => {
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
export const stackTemplates = (
  components: StageComponents &
    Pick<ApplicationStageProps, 'payouts' | 'captionTranslation'>,
) => {
  const stage = new ApplicationStage(new App(), 'discava-test', {
    env: { account: '111122223333', region: 'ap-southeast-2' },
    ...components,
  });
  return stage.node.children
    .filter((child): child is Stack => child instanceof Stack)
    .map((child) => [child.node.id, Template.fromStack(child)] as const);
};

// The logical ids of the stack's functions whose role can touch the core
// table or the search collection but which lack the matching deploy-time
// setting: the core-table and search clients read these from the environment,
// so such a function fails on every invocation once deployed.
export const functionsMissingSettings = (template: Template) => {
  const byRole = actionsByRole(template);
  return Object.entries(template.findResources('AWS::Lambda::Function'))
    .filter(([, fn]) => {
      const role = (fn.Properties.Role as { 'Fn::GetAtt': string[] })[
        'Fn::GetAtt'
      ][0];
      const actions = byRole[role] ?? [];
      const variables = fn.Properties.Environment?.Variables ?? {};
      // The stream router only reads the table's stream, not its items.
      const usesTable = actions.some((a) =>
        /^dynamodb:(Get|BatchGet|Query|Put|Update)Item$|^dynamodb:Query$/.test(
          a,
        ),
      );
      const usesSearch = actions.includes('aoss:APIAccessAll');
      return (
        (usesTable && !variables.DISCAVA_DYNAMODB_CORE_TABLE) ||
        (usesSearch && !variables.DISCAVA_OPENSEARCH_SEARCH)
      );
    })
    .map(([id]) => id);
};
