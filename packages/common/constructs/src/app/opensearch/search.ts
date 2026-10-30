/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CfnCustomResource,
  Duration,
  Lazy,
  Names,
  RemovalPolicy,
} from 'aws-cdk-lib';
import { Grant, type IGrantable, type IRole } from 'aws-cdk-lib/aws-iam';
import { Architecture, Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import {
  CfnAccessPolicy,
  CfnCollection,
  CfnCollectionGroup,
  CfnSecurityPolicy,
} from 'aws-cdk-lib/aws-opensearchserverless';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { RuntimeConfig } from '../../core/runtime-config.js';
import { findWorkspaceRoot } from '../../core/workspace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// One rule / statement of the collection's data access policy. The policy
// document is resolved lazily at synth time from the principals this construct
// collects through its grant methods, so a grant made after the construct is
// created is still included.
interface DataAccessRule {
  readonly ResourceType: 'collection' | 'index';
  readonly Resource: readonly string[];
  readonly Permission: readonly string[];
}
interface DataAccessStatement {
  readonly Description: string;
  readonly Rules: readonly DataAccessRule[];
  readonly Principal: string[];
}

/**
 * A stage's OpenSearch Serverless collection: the search backend for
 * cross-content-type search (issue #53), over the single DynamoDB core table.
 *
 * The collection lives in a **Next Gen** collection group, which scales to
 * zero: its minimum search and indexing capacity are 0 OCUs, so an idle
 * collection is not charged for compute. The group's capacity *limits* cap
 * how much it may scale to (max search and indexing OCUs); a max of 2 is the
 * smallest AWS allows. The collection itself is IAM-authenticated only,
 * encrypted at rest with an AWS-owned key.
 *
 * A network policy allows the public endpoint (the API and indexing Lambdas
 * run outside a VPC and reach the collection over the internet), and a data
 * access policy scopes which principals may read and which may write. Every
 * data-access principal also needs an IAM policy allowing `aoss:APIAccessAll`
 * on the collection; this construct adds it alongside the data access grant.
 *
 * The two Lambdas that touch the collection are granted by the infra stack
 * that owns this construct, in the same stack: the core-api search function
 * (read) and the search indexer (read-write).
 *
 * The indices (courses, modules, lessons, content items, users) are created by
 * an index-sync custom resource on every deploy, from the manifest generated
 * out of `@discava/search`'s index definitions. The sync creates a missing
 * index and adds new mappings to an existing one, and never deletes an index,
 * so a deploy can't destroy search data.
 */
export class SearchCollection extends Construct {
  /** The collection's endpoint, published to the runtime config. */
  public readonly endpoint: string;
  /** The collection's ARN, for the IAM (aoss) layer of access. */
  public readonly collectionArn: string;
  /** The data access policy; the index-sync resource waits for it. */
  public readonly dataAccessPolicy: CfnAccessPolicy;

  // Data-access principals, split by what they may do. A read-write principal
  // is also a reader, so it appears in both statements.
  private readonly readOnly: IGrantable[] = [];
  private readonly readWrite: IGrantable[] = [];
  private readonly collectionName: string;

  constructor(
    scope: Construct,
    id: string,
    props: {
      /**
       * What happens to the collection (and the data in its indices) when the
       * stack is deleted.
       *
       * @default RemovalPolicy.RETAIN
       */
      readonly removalPolicy?: RemovalPolicy;
      /**
       * The upper bound of the collection group's search capacity, in OCUs.
       * The collection scales between 0 and this many OCUs, so an idle
       * collection scales to zero.
       *
       * @default 2 (the smallest AWS allows)
       */
      readonly maxSearchOcu?: number;
      /**
       * The upper bound of the collection group's indexing capacity, in OCUs.
       *
       * @default 2 (the smallest AWS allows)
       */
      readonly maxIndexingOcu?: number;
    } = {},
  ) {
    super(scope, id);

    // OpenSearch Serverless names are lowercase-only (a-z, 0-9, -): a
    // collection ≤ 28 chars, a policy ≤ 32. The policy names below append a
    // suffix, so the base stays ≤ 26 to keep every derived name in range.
    // (Names.uniqueResourceName emits uppercase, so it is lowercased.)
    this.collectionName = Names.uniqueResourceName(this, {
      maxLength: 26,
      separator: '-',
    }).toLowerCase();
    const name = this.collectionName;
    const removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;

    // The Next Gen collection group the collection scales in. A minimum of 0
    // OCUs is what makes it scale to zero: with no traffic the collection
    // drops to 0 and costs no compute, waking to at least a baseline OCU on
    // the next request. The max is the ceiling it may scale to. A group name
    // is ≤ 32 chars, so the base (≤ 26) plus `-grp` stays in range.
    const groupName = `${name}-grp`;
    const collectionGroup = new CfnCollectionGroup(this, 'CollectionGroup', {
      name: groupName,
      generation: 'NEXTGEN',
      standbyReplicas: 'DISABLED',
      capacityLimits: {
        minSearchCapacityInOcu: 0,
        minIndexingCapacityInOcu: 0,
        maxSearchCapacityInOcu: props.maxSearchOcu ?? 2,
        maxIndexingCapacityInOcu: props.maxIndexingOcu ?? 2,
      },
    });
    collectionGroup.applyRemovalPolicy(removalPolicy);

    // Allow the public endpoint for the collection and its (unused) Dashboards
    // endpoint. The Lambdas that reach it run outside a VPC; access is still
    // gated by SigV4 and the data access policy below.
    const networkPolicy = new CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: `${name}-net`,
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            { ResourceType: 'collection', Resource: [`collection/${name}`] },
            { ResourceType: 'dashboard', Resource: [`collection/${name}`] },
          ],
          AllowFromPublic: true,
        },
      ]),
    });

    const collection = new CfnCollection(this, 'Collection', {
      name,
      type: 'SEARCH',
      // At rest, encrypted with an AWS-owned key (no customer KMS key).
      encryptionConfig: { awsOwnedKey: true },
      deletionProtection: 'ENABLED',
      // A Next Gen collection scales in its group; the group carries the
      // standby-replica and capacity settings.
      collectionGroupName: groupName,
    });
    collection.applyRemovalPolicy(removalPolicy);
    // The collection references the group by name, which CloudFormation does
    // not infer as a dependency, so state it: the group must exist first.
    collection.addResourceDependency(collectionGroup);
    // The network policy must exist before the collection is created.
    collection.addResourceDependency(networkPolicy);

    this.endpoint = collection.attrCollectionEndpoint;
    this.collectionArn = collection.attrArn;

    // Created before the index-sync resource, which depends on it and whose
    // handler is granted read-write access (a principal of this policy).
    this.dataAccessPolicy = new CfnAccessPolicy(this, 'DataAccessPolicy', {
      name: `${name}-data`,
      type: 'data',
      policy: Lazy.string({
        produce: () => JSON.stringify(this.statements()),
      }),
    });

    this.syncIndices(collection);

    // The endpoint is published to the runtime config (the `opensearch`
    // namespace, `Search` key), which the search client and the indexer read
    // at request time.
    RuntimeConfig.ensure(this).set('opensearch', 'Search', {
      endpoint: this.endpoint,
    });
  }

  /**
   * Allows `grantee` to run searches against the collection's indices.
   */
  public grantReadOnly(grantee: IGrantable): void {
    this.readOnly.push(grantee);
    this.grantAossApi(grantee);
  }

  /**
   * Allows `grantee` to read and write the collection's indices.
   */
  public grantReadWrite(grantee: IGrantable): void {
    this.readWrite.push(grantee);
    this.grantAossApi(grantee);
  }

  // The IAM (aoss) gate every data-access principal needs, on top of the data
  // access policy.
  private grantAossApi(grantee: IGrantable): void {
    Grant.addToPrincipal({
      grantee,
      actions: ['aoss:APIAccessAll'],
      resourceArns: [this.collectionArn],
    });
  }

  // The index-sync custom resource: a Lambda behind a Provider that creates
  // the indices (or adds new mappings to them) on every deploy. The manifest
  // is inlined into the resource's properties, so a manifest change updates
  // the resource and re-runs the sync.
  private syncIndices(collection: CfnCollection): void {
    const manifest = this.loadIndicesManifest();

    const handler = new Function(this, 'IndexSync', {
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      timeout: Duration.minutes(5),
      code: Code.fromAsset(
        join(
          findWorkspaceRoot(__dirname),
          'dist/packages/databases/search/bundle/index-sync',
        ),
      ),
    });

    // The sync handler creates and updates indices, so it is a read-write
    // principal (its role goes into the data access policy).
    this.grantReadWrite(handler);

    // The handler creates/updates all indices and returns, so it is complete
    // when it returns: no isCompleteHandler is needed.
    const provider = new Provider(this, 'IndexSyncProvider', {
      onEventHandler: handler,
    });

    const resource = new CfnCustomResource(this, 'IndexSyncResource', {
      serviceToken: provider.serviceToken,
    });
    // CfnCustomResource exposes only ServiceToken/ServiceTimeout as props; the
    // rest are custom properties, set as overrides (resolved at synth).
    resource.addPropertyOverride('endpoint', this.endpoint);
    resource.addPropertyOverride('indices', manifest);

    // The sync needs the collection and its data access in place first.
    resource.addResourceDependency(collection);
    resource.addResourceDependency(this.dataAccessPolicy);
  }

  // The index definitions, flattened to the manifest the sync handler
  // expects. Read from the generated file (built by @discava/search's
  // `indices` target) rather than importing the TS, so the construct has no
  // source dependency on @discava/search.
  private loadIndicesManifest(): Record<string, unknown>[] {
    const path = join(
      findWorkspaceRoot(__dirname),
      'dist/packages/databases/search/indices/indices.json',
    );
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>[];
  }

  // The data access policy document, built from the collected grants. Runs at
  // synth (inside Lazy), when every granted role's ARN can be resolved.
  private statements(): DataAccessStatement[] {
    const name = this.collectionName;
    // The granted principals are the Lambdas' execution roles (Lambda is an
    // IRole, whose roleArn is resolvable); fall back to the generic principal
    // for any non-role grantee.
    const arn = (g: IGrantable) =>
      (g as IRole).roleArn ??
      g.grantPrincipal.policyFragment.principalJson?.AWS?.[0];
    const statements: DataAccessStatement[] = [];
    const readers = this.readOnly.concat(this.readWrite).map(arn);
    if (readers.length > 0) {
      statements.push({
        Description: 'Search read access',
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${name}`],
            Permission: ['aoss:DescribeCollectionItems'],
          },
          {
            ResourceType: 'index',
            Resource: [`index/${name}/*`],
            Permission: ['aoss:ReadDocument'],
          },
        ],
        Principal: readers,
      });
    }
    const writers = this.readWrite.map(arn);
    if (writers.length > 0) {
      statements.push({
        Description: 'Search read-write access',
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${name}`],
            Permission: [
              'aoss:DescribeCollectionItems',
              'aoss:CreateCollectionItems',
              'aoss:UpdateCollectionItems',
            ],
          },
          {
            ResourceType: 'index',
            Resource: [`index/${name}/*`],
            Permission: [
              'aoss:CreateIndex',
              'aoss:UpdateIndex',
              'aoss:DescribeIndex',
              'aoss:ReadDocument',
              'aoss:WriteDocument',
            ],
          },
        ],
        Principal: writers,
      });
    }
    return statements;
  }
}
