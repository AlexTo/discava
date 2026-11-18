/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import {
  CfnResource,
  CustomResource,
  Duration,
  Lazy,
  RemovalPolicy,
  Stack,
} from 'aws-cdk-lib';
import { Grant, IRole } from 'aws-cdk-lib/aws-iam';
import { IKey, Key } from 'aws-cdk-lib/aws-kms';
import {
  Architecture,
  Code,
  Function,
  Runtime,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import {
  CfnAccessPolicy,
  CfnCollection,
  CfnCollectionGroup,
  CfnSecurityPolicy,
} from 'aws-cdk-lib/aws-opensearchserverless';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { suppressRules } from './checkov.js';
import { RuntimeConfig } from './runtime-config.js';

/** One index's settings/mappings, as the search package's manifest holds it. */
export interface OpenSearchIndexManifestEntry {
  readonly name: string;
  readonly settings?: Record<string, unknown>;
  readonly mappings: Record<string, unknown>;
}

export interface OpenSearchCollectionProps {
  /**
   * The collection's name. OpenSearch Serverless requires one (unlike a
   * DynamoDB table, it can't auto-generate it), and the security/access
   * policies below are keyed on it. Must be unique per account and region,
   * and 3-21 characters (lowercase letters, digits, hyphens; starting with a
   * letter), so every policy name derived from it fits OpenSearch
   * Serverless's 32-character limit.
   */
  readonly collectionName: string;

  /** RuntimeConfig key used under the `opensearch` namespace. */
  readonly runtimeConfigKey: string;

  readonly description?: string;

  /**
   * The collection group's indexing capacity floor and ceiling, in OCUs
   * (NextGen's unit of compute). A minimum of 0 is true scale-to-zero: no
   * cost while idle, at the price of a ~10-30s cold start on the first
   * request after one. A non-zero minimum keeps that capacity always warm
   * (a small continuous cost) so real traffic never pays that latency.
   *
   * @default 0
   */
  readonly minIndexingCapacityInOcu?: number;

  /**
   * @default 4
   */
  readonly maxIndexingCapacityInOcu?: number;

  /** Same tradeoff as `minIndexingCapacityInOcu`, for search capacity.
   *
   * @default 0
   */
  readonly minSearchCapacityInOcu?: number;

  /**
   * @default 4
   */
  readonly maxSearchCapacityInOcu?: number;

  /**
   * Server-side encryption's KMS key. Only used when `enableKmsEncryption`
   * is true. When not provided, a new key is created.
   */
  readonly encryptionKey?: IKey;

  /**
   * Use a customer-managed KMS key for encryption instead of an AWS-owned
   * one.
   *
   * @default true
   */
  readonly enableKmsEncryption?: boolean;

  /**
   * Whether to enable automatic key rotation on the KMS key used to encrypt
   * the collection. Only used when `enableKmsEncryption` is true.
   *
   * @default true
   */
  readonly enableKeyRotation?: boolean;

  /**
   * Allow network access to the collection (and its dashboard) from the
   * public internet rather than only from VPC endpoints. The account has no
   * VPC set up for any other resource (every Lambda here runs outside one),
   * so this is the only option until one exists; actual access is still
   * gated by SigV4 signing and the data access policy below, the same as
   * any other AWS API.
   *
   * @default true
   */
  readonly allowFromPublic?: boolean;

  /**
   * What to do with the collection when the stack is deleted.
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;

  /** The indices to create/keep in sync, from the search package's manifest. */
  readonly indices: readonly OpenSearchIndexManifestEntry[];

  /**
   * A hash of `indices`. Passed through to the index-sync custom resource as
   * a resource property, and returned by it so a deploy shows which manifest
   * was applied. (The sync itself runs on every deploy, see `SyncedAt`.)
   */
  readonly manifestHash: string;

  /** The index-sync Lambda's code (search package's `index-sync` bundle). */
  readonly indexSyncHandlerCode: Code;
}

interface AccessStatement {
  readonly principalArn: string;
  readonly indexPermissions: readonly string[];
  readonly collectionPermissions: readonly string[];
}

const READ_INDEX_PERMISSIONS = ['aoss:DescribeIndex', 'aoss:ReadDocument'];
const READ_COLLECTION_PERMISSIONS = ['aoss:DescribeCollectionItems'];
const WRITE_INDEX_PERMISSIONS = [
  'aoss:CreateIndex',
  'aoss:UpdateIndex',
  'aoss:DescribeIndex',
  'aoss:ReadDocument',
  'aoss:WriteDocument',
];
const WRITE_COLLECTION_PERMISSIONS = [
  'aoss:CreateCollectionItems',
  'aoss:UpdateCollectionItems',
  'aoss:DescribeCollectionItems',
];

// One statement per distinct permission set, listing every principal that
// holds it. A grantee can be granted many times (the shared router Lambda gets
// one grant per procedure), and a statement per grant repeats the same rules
// until the policy outgrows OpenSearch Serverless's 20KB limit.
const renderAccessPolicy = (
  collectionName: string,
  statements: readonly AccessStatement[],
): unknown[] => {
  const grouped = new Map<
    string,
    { statement: AccessStatement; principals: Set<string> }
  >();
  for (const statement of statements) {
    const key = JSON.stringify([
      statement.indexPermissions,
      statement.collectionPermissions,
    ]);
    const group = grouped.get(key);
    if (group) group.principals.add(statement.principalArn);
    else
      grouped.set(key, {
        statement,
        principals: new Set([statement.principalArn]),
      });
  }
  return [...grouped.values()].map(
    ({
      statement: { indexPermissions, collectionPermissions },
      principals,
    }) => ({
      Rules: [
        {
          ResourceType: 'index',
          Resource: [`index/${collectionName}/*`],
          Permission: indexPermissions,
        },
        {
          ResourceType: 'collection',
          Resource: [`collection/${collectionName}`],
          Permission: collectionPermissions,
        },
      ],
      Principal: [...principals],
    }),
  );
};

// OpenSearch Serverless caps security/access policy and collection group
// names at 32 characters; the longest suffix this construct appends to the
// collection's name is `-encryption`.
const MAX_COLLECTION_NAME_LENGTH = 32 - '-encryption'.length;
const COLLECTION_NAME_PATTERN = new RegExp(
  `^[a-z][a-z0-9-]{2,${MAX_COLLECTION_NAME_LENGTH - 1}}$`,
);

/**
 * An Amazon OpenSearch Serverless collection: a NextGen collection group (the
 * generation with no fixed OCU floor -- a minimum of 0 scales to zero cost
 * while idle, unlike classic's always-on 2-OCU minimum) holding one
 * collection, that collection's encryption/network/data-access security
 * policies, and the custom resource that creates its indices and keeps their
 * mappings in sync (never deletes one). There's no CDK L2 construct for
 * Serverless yet, only the L1 `Cfn*` resources this wraps.
 *
 * `grantRead`/`grantWrite` add a data access policy for the grantee
 * (OpenSearch Serverless authorises by principal ARN there, not by the
 * grantee's own IAM policy) as well as granting the IAM `aoss:APIAccessAll`
 * action needed for a SigV4-signed request to reach the collection at all.
 * Each grantee's policy is its own resource in the grantee's own stack, named
 * from the grantee's construct path. A policy shared by every grantee would
 * have to live in a stack that depends on all of them, and so import their
 * role ARNs: moving a Lambda between stacks would then fail on a deployed
 * stage (CloudFormation won't delete an export another stack still imports).
 * Per-grantee policies leave nothing to import, and the grantee's stack
 * already depends on this one through the collection's ARN.
 */
export abstract class OpenSearchCollection extends Construct {
  public readonly collection: CfnCollection;
  private readonly collectionName: string;
  // One entry per grantee: the same role can be granted more than once (the
  // shared router Lambda backs many procedures), and all its grants share
  // its one policy.
  private readonly grantees = new Map<string, AccessStatement[]>();

  constructor(
    scope: Construct,
    id: string,
    {
      collectionName,
      runtimeConfigKey,
      description,
      minIndexingCapacityInOcu = 0,
      maxIndexingCapacityInOcu = 4,
      minSearchCapacityInOcu = 0,
      maxSearchCapacityInOcu = 4,
      encryptionKey,
      enableKmsEncryption = true,
      enableKeyRotation = true,
      allowFromPublic = true,
      removalPolicy = RemovalPolicy.RETAIN,
      indices,
      manifestHash,
      indexSyncHandlerCode,
    }: OpenSearchCollectionProps,
  ) {
    super(scope, id);
    if (!COLLECTION_NAME_PATTERN.test(collectionName)) {
      throw new Error(
        `Invalid OpenSearch collection name '${collectionName}': it must be 3-${MAX_COLLECTION_NAME_LENGTH} characters, lowercase letters, digits and hyphens, starting with a letter`,
      );
    }
    this.collectionName = collectionName;

    const key: IKey | undefined = enableKmsEncryption
      ? (encryptionKey ??
        new Key(this, 'EncryptionKey', { enableKeyRotation, removalPolicy }))
      : undefined;

    const encryptionPolicy = new CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: `${collectionName}-encryption`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${collectionName}`],
          },
        ],
        ...(key ? { KmsARN: key.keyArn } : { AWSOwnedKey: true }),
      }),
    });

    const networkPolicy = new CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: `${collectionName}-network`,
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
            },
            {
              ResourceType: 'dashboard',
              Resource: [`collection/${collectionName}`],
            },
          ],
          AllowFromPublic: allowFromPublic,
        },
      ]),
    });

    // NextGen (as opposed to the classic generation, which has a fixed
    // 2-OCU floor whether or not anything is happening): capacity -- and so
    // cost -- is set per collection *group*, not per collection. Standby
    // replicas move here too (CfnCollectionGroupProps requires it; the
    // member collection no longer sets its own). Always ENABLED: a NextGen
    // group rejects DISABLED ("StandbyReplicas cannot be set to DISABLED for
    // NEXTGEN collection groups", InvalidRequest), so there's no toggle.
    const collectionGroup = new CfnCollectionGroup(this, 'CollectionGroup', {
      name: `${collectionName}-group`,
      generation: 'NEXTGEN',
      standbyReplicas: 'ENABLED',
      capacityLimits: {
        minIndexingCapacityInOcu,
        maxIndexingCapacityInOcu,
        minSearchCapacityInOcu,
        maxSearchCapacityInOcu,
      },
    });

    this.collection = new CfnCollection(this, runtimeConfigKey, {
      name: collectionName,
      description,
      type: 'SEARCH',
      collectionGroupName: collectionGroup.name,
    });
    this.collection.addResourceDependency(collectionGroup);
    this.collection.addResourceDependency(encryptionPolicy);
    this.collection.addResourceDependency(networkPolicy);
    this.collection.applyRemovalPolicy(removalPolicy);

    const rc = RuntimeConfig.ensure(this);
    rc.set('opensearch', runtimeConfigKey, {
      endpoint: this.collection.attrCollectionEndpoint,
    });

    this.createIndexSync(
      collectionName,
      indexSyncHandlerCode,
      indices,
      manifestHash,
    );
  }

  private grant(
    grantee: IRole,
    indexPermissions: readonly string[],
    collectionPermissions: readonly string[],
  ): void {
    Grant.addToPrincipal({
      grantee,
      actions: ['aoss:APIAccessAll'],
      resourceArns: [this.collection.attrArn],
    });
    const statement = {
      principalArn: grantee.roleArn,
      indexPermissions,
      collectionPermissions,
    };
    const existing = this.grantees.get(grantee.node.path);
    if (existing) {
      existing.push(statement);
      return;
    }
    const statements = [statement];
    this.grantees.set(grantee.node.path, statements);

    // Policy names are capped at 32 characters and the collection name at 21
    // (see MAX_COLLECTION_NAME_LENGTH), leaving room for `-` and 8 hex digits.
    const suffix = createHash('sha256')
      .update(grantee.node.path)
      .digest('hex')
      .slice(0, 8);
    const stack = Stack.of(grantee);
    const accessPolicy = new CfnAccessPolicy(
      stack,
      `${this.node.id}Access${suffix}`,
      {
        name: `${this.collectionName}-${suffix}`,
        type: 'data',
        policy: Lazy.string({
          produce: () =>
            stack.toJsonString(
              renderAccessPolicy(this.collectionName, statements),
            ),
        }),
      },
    );
    accessPolicy.node.addDependency(this.collection);
  }

  /** Lets `grantee` read (search/get) documents in every index. */
  public grantRead(grantee: IRole): void {
    this.grant(grantee, READ_INDEX_PERMISSIONS, READ_COLLECTION_PERMISSIONS);
  }

  /**
   * Lets `grantee` read, write and delete documents (`aoss:WriteDocument`
   * covers deletes; there is no separate delete permission), and create
   * indices/update mappings.
   */
  public grantWrite(grantee: IRole): void {
    this.grant(grantee, WRITE_INDEX_PERMISSIONS, WRITE_COLLECTION_PERMISSIONS);
  }

  // The index-sync handler always lives in this construct's own stack (it's
  // created right below), so its self-grant gets its own policy, eager and
  // same-stack, instead of going through the deferred mechanism above: the
  // custom resource that invokes it runs during this stack's own deploy, so
  // its grant must already exist by then, not merely by the time
  // grantRead/grantWrite's (possibly later-deploying) policy lands.
  private createIndexSync(
    collectionName: string,
    code: Code,
    indices: readonly OpenSearchIndexManifestEntry[],
    manifestHash: string,
  ): void {
    const handler = new Function(this, 'IndexSyncHandler', {
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code,
      timeout: Duration.minutes(5),
      tracing: Tracing.ACTIVE,
      // The collection's endpoint, directly: this runs while this stack
      // deploys, before RuntimeConfig's AppConfig content (which reads from
      // every stack, so deploys last) exists to look it up in. Only ever
      // holds that (a GetAtt); checkov's secret scan also reads a __file__
      // key its own parser injects (the template's path), and this
      // construct's CDK-hashed template file name trips CKV_AWS_45 on it, the
      // same false positive data-stack.ts suppresses for PreTokenGeneration.
      environment: {
        OPENSEARCH_ENDPOINT: this.collection.attrCollectionEndpoint,
      },
    });

    Grant.addToPrincipal({
      grantee: handler,
      actions: ['aoss:APIAccessAll'],
      resourceArns: [this.collection.attrArn],
    });
    const bootstrapAccessPolicy = new CfnAccessPolicy(
      this,
      'BootstrapAccessPolicy',
      {
        name: `${collectionName}-bootstrap`,
        type: 'data',
        policy: Stack.of(this).toJsonString(
          renderAccessPolicy(collectionName, [
            {
              principalArn: handler.role!.roleArn,
              indexPermissions: WRITE_INDEX_PERMISSIONS,
              collectionPermissions: WRITE_COLLECTION_PERMISSIONS,
            },
          ]),
        ),
      },
    );
    bootstrapAccessPolicy.addResourceDependency(this.collection);

    const provider = new Provider(this, 'IndexSyncProvider', {
      onEventHandler: handler,
    });
    const resource = new CustomResource(this, 'IndexSync', {
      serviceToken: provider.serviceToken,
      properties: {
        Manifest: JSON.stringify({ indices, hash: manifestHash }),
        ManifestHash: manifestHash,
        // CloudFormation only calls the handler again when a property
        // changes, and the manifest doesn't change when an index is deleted
        // by hand or the collection is replaced (a new name, say), which
        // leaves an empty collection. A value that differs on every
        // synthesis makes every deploy run the sync, which is safe: it only
        // creates what's missing and re-applies mappings.
        SyncedAt: new Date().toISOString(),
      },
    });
    // The handler's own grant must already be in place before it runs, and
    // the collection must exist before the handler can reach it.
    resource.node.addDependency(bootstrapAccessPolicy);

    // Same false positive as the handler's own environment above, on both
    // it and the Provider framework's own onEvent function (which only ever
    // holds the handler's Lambda ARN, to invoke it).
    suppressRules(
      this,
      ['CKV_AWS_45'],
      "Lambda environments here hold the collection's endpoint or another function's ARN, not secrets; checkov's injected template path trips this rule",
      (c) =>
        CfnResource.isCfnResource(c) &&
        c.cfnResourceType === 'AWS::Lambda::Function' &&
        c.node.path.includes('IndexSync'),
    );
  }
}
