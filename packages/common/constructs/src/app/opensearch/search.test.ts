/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
// (CDK resolves the index-sync asset path from import.meta.url, which jsdom
// doesn't provide; the index manifest is read from the workspace at synth.)
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { describe, expect, it } from 'vitest';
import { RuntimeConfig } from '../../core/runtime-config.js';
import { SearchCollection } from './search.js';

// Resolves CloudFormation intrinsics (Fn::Join, Fn::GetAtt, Ref) to plain
// text so a token-laden string can be read: a join becomes its parts
// concatenated, a GetAtt/Ref becomes the referenced logical id.
const flatten = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (node && typeof node === 'object') {
    const [fn, arg] = Object.entries(node)[0] as [string, unknown];
    switch (fn) {
      case 'Fn::Join':
        return flatten(arg);
      case 'Fn::GetAtt':
        return Array.isArray(arg) ? String(arg[0]) : String(arg);
      case 'Ref':
        return String(arg);
      default:
        return flatten(arg);
    }
  }
  return '';
};

// Synthesizes a stack holding a search collection with one read-only and one
// read-write principal, the way the core-api stack wires it.
const setup = () => {
  const stack = new Stack(new App(), 'Stack', {
    env: { account: '111122223333', region: 'ap-southeast-2' },
  });
  const collection = new SearchCollection(stack, 'Search');
  const reader = new Role(stack, 'Reader', {
    assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
  });
  const writer = new Role(stack, 'Writer', {
    assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
  });
  collection.grantReadOnly(reader);
  collection.grantReadWrite(writer);
  // Register the runtime-config aspect (the real stack does this by granting
  // the search function and indexer AppConfig read), so the opensearch
  // namespace's version is part of the template.
  RuntimeConfig.ensure(stack).grantReadAppConfig(reader);
  return { stack, collection, reader, writer };
};

// The logical id of the stack's role for the given construct, so a policy
// statement can be matched against a role without its (token) ARN.
const roleId = (template: Template, role: Role): string =>
  Object.entries(template.findResources('AWS::IAM::Role')).find(
    ([id]) => id === role.node.id || id.startsWith(role.node.id),
  )?.[0] as string;

describe('SearchCollection', { timeout: 30_000 }, () => {
  it('creates one collection, one network policy and one data policy', () => {
    const { stack } = setup();
    const template = Template.fromStack(stack);
    expect(
      Object.keys(
        template.findResources('AWS::OpenSearchServerless::Collection'),
      ),
    ).toHaveLength(1);
    expect(
      Object.keys(
        template.findResources('AWS::OpenSearchServerless::SecurityPolicy'),
      ),
    ).toHaveLength(1);
    expect(
      Object.keys(
        template.findResources('AWS::OpenSearchServerless::AccessPolicy'),
      ),
    ).toHaveLength(1);
  });

  it('puts the collection in a Next Gen group that scales to zero', () => {
    const { stack } = setup();
    const template = Template.fromStack(stack);
    const [group] = Object.values(
      template.findResources('AWS::OpenSearchServerless::CollectionGroup'),
    ) as {
      Properties: {
        Generation: string;
        StandbyReplicas: string;
        CapacityLimits: {
          MinSearchCapacityInOcu: number;
          MinIndexingCapacityInOcu: number;
          MaxSearchCapacityInOcu: number;
          MaxIndexingCapacityInOcu: number;
        };
      };
    }[];
    expect(group).toBeDefined();
    expect(group.Properties.Generation).toBe('NEXTGEN');
    // A minimum of 0 OCUs is the scale-to-zero guarantee.
    expect(group.Properties.CapacityLimits.MinSearchCapacityInOcu).toBe(0);
    expect(group.Properties.CapacityLimits.MinIndexingCapacityInOcu).toBe(0);
    // The max is the ceiling; 2 is the smallest AWS allows.
    expect(group.Properties.CapacityLimits.MaxSearchCapacityInOcu).toBe(2);
    expect(group.Properties.CapacityLimits.MaxIndexingCapacityInOcu).toBe(2);

    // The collection names the group (and depends on it so it exists first).
    const [collection] = Object.values(
      template.findResources('AWS::OpenSearchServerless::Collection'),
    ) as {
      Properties: { CollectionGroupName: unknown };
      DependsOn?: string | string[];
    }[];
    expect(collection.Properties.CollectionGroupName).toBe(
      group.Properties.Name,
    );
    const deps = [collection.DependsOn].flat() as string[];
    expect(deps).toContain(
      Object.keys(
        template.findResources('AWS::OpenSearchServerless::CollectionGroup'),
      )[0],
    );
  });

  it('encrypts the collection with an AWS-owned key and allows the public endpoint', () => {
    const { stack } = setup();
    const template = Template.fromStack(stack);
    const [collection] = Object.values(
      template.findResources('AWS::OpenSearchServerless::Collection'),
    ) as { Properties: { EncryptionConfig: { AWSOwnedKey: boolean } } }[];
    expect(collection.Properties.EncryptionConfig).toEqual({
      AWSOwnedKey: true,
    });

    const [network] = Object.values(
      template.findResources('AWS::OpenSearchServerless::SecurityPolicy'),
    ) as { Properties: { Type: string; Policy: string } }[];
    expect(network.Properties.Type).toBe('network');
    const statement = (
      JSON.parse(network.Properties.Policy) as {
        Rules: { ResourceType: string; Resource: string[] }[];
        AllowFromPublic: boolean;
      }[]
    )[0];
    expect(statement.AllowFromPublic).toBe(true);
    expect(statement.Rules.map((r) => r.ResourceType)).toEqual(
      expect.arrayContaining(['collection', 'dashboard']),
    );
  });

  it('scopes the data policy: readers read, writers read and write', () => {
    const { stack, reader, writer } = setup();
    const template = Template.fromStack(stack);
    const [dataPolicy] = Object.values(
      template.findResources('AWS::OpenSearchServerless::AccessPolicy'),
    ) as { Properties: { Policy: unknown } }[];
    const policy = flatten(dataPolicy.Properties.Policy);
    // Both principals are readers (a writer may also read); only the writer
    // gets the write permissions, on the collection's indices.
    expect(policy).toContain(roleId(template, reader));
    expect(policy).toContain(roleId(template, writer));
    expect(policy).toContain('aoss:ReadDocument');
    expect(policy).toContain('aoss:WriteDocument');
    expect(policy).toContain('aoss:CreateIndex');
  });

  it('grants each principal aoss:APIAccessAll on the collection', () => {
    const { stack, reader, writer } = setup();
    const template = Template.fromStack(stack);
    // Each granted role carries an aoss:APIAccessAll statement scoped to the
    // collection (the IAM gate on top of the data access policy).
    const aossStatementsFor = (role: Role) =>
      Object.values(template.findResources('AWS::IAM::Policy'))
        .filter((p) =>
          JSON.stringify(p.Properties.Roles).includes(roleId(template, role)),
        )
        .flatMap(
          (p) =>
            (p.Properties.PolicyDocument as { Statement: unknown[] }).Statement,
        )
        .filter((s) => JSON.stringify(s).includes('aoss:APIAccessAll'));
    expect(aossStatementsFor(reader)).toHaveLength(1);
    expect(aossStatementsFor(writer)).toHaveLength(1);
  });

  it('wires an index-sync custom resource depending on the collection and data policy', () => {
    const { stack } = setup();
    const template = Template.fromStack(stack);
    const resources = Object.entries(
      template.findResources('AWS::CloudFormation::CustomResource'),
    );
    const [syncId, sync] = resources.find(([id]) => id.includes('IndexSync'));
    expect(syncId).toBeDefined();
    const properties = JSON.stringify(
      (sync as { Properties: unknown }).Properties,
    );
    expect(properties).toContain('"endpoint"');
    expect(properties).toContain('"indices"');
    const deps = [
      (sync as { DependsOn?: unknown }).DependsOn,
    ].flat() as string[];
    expect(deps.some((d) => d.includes('Collection'))).toBe(true);
    expect(deps.some((d) => d.includes('DataAccessPolicy'))).toBe(true);
  });

  it('publishes the collection endpoint to the opensearch Search config', () => {
    const { stack } = setup();
    const template = Template.fromStack(stack);
    const versions = Object.values(
      template.findResources('AWS::AppConfig::HostedConfigurationVersion'),
    ) as { Properties: { ContentType: string; Content: unknown } }[];
    const searchVersion = versions.find((v) =>
      flatten(v.Properties.Content).includes('"Search"'),
    );
    expect(searchVersion).toBeDefined();
    expect(searchVersion?.Properties.ContentType).toBe('application/json');
    const content = flatten(searchVersion?.Properties.Content ?? '');
    expect(content).toContain('"endpoint"');
  });
});
