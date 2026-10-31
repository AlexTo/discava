/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Aspects,
  CfnResource,
  CustomResource,
  Duration,
  RemovalPolicy,
  Stack,
  Stage,
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
import { Construct, IConstruct } from 'constructs';
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
   * Multi-AZ with standby replicas, for zero-downtime during an AZ outage.
   * Roughly doubles OCU cost, so off by default in a development stage. A
   * property of the collection *group* (NextGen), not the collection itself.
   *
   * @default true
   */
  readonly standbyReplicas?: boolean;

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
   * a resource property, so changing it (and only it) is what makes
   * CloudFormation re-run index-sync on deploy.
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

const renderAccessPolicy = (
  collectionName: string,
  statements: readonly AccessStatement[],
): unknown[] =>
  statements.map(
    ({ principalArn, indexPermissions, collectionPermissions }) => ({
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
      Principal: [principalArn],
    }),
  );

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
 * `grantRead`/`grantWrite` add the grantee to a data access policy
 * (OpenSearch Serverless authorises by principal ARN there, not by the
 * grantee's own IAM policy) as well as granting the IAM `aoss:APIAccessAll`
 * action needed for a SigV4-signed request to reach the collection at all.
 * That policy's creation is deferred to synth time (the same technique
 * RuntimeConfig uses), because a grantee can live in a stack created after
 * this one (e.g. CoreApi, which depends on Data for the collection itself):
 * if the policy resource lived directly in this construct's own stack, a
 * cross-stack grantee's role ARN would make that stack depend back on the
 * grantee's, a cycle. By default the policy is placed in this construct's
 * own stack (safe for a same-stack grantee, e.g. the index-sync handler
 * below); call `placeAccessPolicyIn` with a stack that depends on every
 * grantee's stack (such as RuntimeConfig, which already deploys last)
 * before any cross-stack grant.
 */
export abstract class OpenSearchCollection extends Construct {
  public readonly collection: CfnCollection;
  private readonly collectionName: string;
  private readonly statements: AccessStatement[] = [];
  private accessPolicyStack?: Stack;
  private accessPolicyAspectRegistered = false;

  constructor(
    scope: Construct,
    id: string,
    {
      collectionName,
      runtimeConfigKey,
      description,
      standbyReplicas = true,
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
    // member collection no longer sets its own).
    const collectionGroup = new CfnCollectionGroup(this, 'CollectionGroup', {
      name: `${collectionName}-group`,
      generation: 'NEXTGEN',
      standbyReplicas: standbyReplicas ? 'ENABLED' : 'DISABLED',
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
    this.collection.addDependency(collectionGroup);
    this.collection.addDependency(encryptionPolicy);
    this.collection.addDependency(networkPolicy);
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

  /**
   * Where the data access policy populated by `grantRead`/`grantWrite` is
   * created. Call this before any grant whose grantee lives in a stack this
   * construct's own stack doesn't already depend on -- see the class doc.
   */
  public placeAccessPolicyIn(stack: Stack): void {
    this.accessPolicyStack = stack;
  }

  private ensureAccessPolicy(): void {
    if (this.accessPolicyAspectRegistered) return;
    this.accessPolicyAspectRegistered = true;
    let created = false;

    Aspects.of(Stage.of(this) ?? Stack.of(this)).add({
      visit: (node: IConstruct) => {
        if (created || !(node instanceof Stack)) return;
        created = true;
        const stack = this.accessPolicyStack ?? Stack.of(this);
        const accessPolicy = new CfnAccessPolicy(
          stack,
          `${this.node.id}AccessPolicy`,
          {
            name: `${this.collectionName}-access`,
            type: 'data',
            policy: stack.toJsonString(
              renderAccessPolicy(this.collectionName, this.statements),
            ),
          },
        );
        accessPolicy.node.addDependency(this.collection);
      },
    });
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
    this.statements.push({
      principalArn: grantee.roleArn,
      indexPermissions,
      collectionPermissions,
    });
    this.ensureAccessPolicy();
  }

  /** Lets `grantee` read (search/get) documents in every index. */
  public grantRead(grantee: IRole): void {
    this.grant(grantee, READ_INDEX_PERMISSIONS, READ_COLLECTION_PERMISSIONS);
  }

  /**
   * Lets `grantee` read and write documents, and create indices/update
   * mappings.
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
      // Only ever holds the AppConfig application's ID (a Ref); checkov's
      // secret scan also reads a __file__ key its own parser injects (the
      // template's path), and this construct's CDK-hashed template file
      // name trips CKV_AWS_45 on it, the same false positive data-stack.ts
      // suppresses for PreTokenGeneration.
      environment: {},
    });
    const runtimeConfig = RuntimeConfig.ensure(this);
    handler.addEnvironment(
      'RUNTIME_CONFIG_APP_ID',
      runtimeConfig.appConfigApplicationId,
    );
    runtimeConfig.grantReadAppConfig(handler);

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
    bootstrapAccessPolicy.addDependency(this.collection);

    const provider = new Provider(this, 'IndexSyncProvider', {
      onEventHandler: handler,
    });
    const resource = new CustomResource(this, 'IndexSync', {
      serviceToken: provider.serviceToken,
      properties: {
        Manifest: JSON.stringify({ indices, hash: manifestHash }),
        ManifestHash: manifestHash,
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
      "Lambda environments here hold the AppConfig application's ID or another function's ARN, not secrets; checkov's injected template path trips this rule",
      (c) =>
        CfnResource.isCfnResource(c) &&
        c.cfnResourceType === 'AWS::Lambda::Function' &&
        c.node.path.includes('IndexSync'),
    );
  }
}
