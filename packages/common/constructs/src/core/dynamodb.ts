/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
  TableProps,
} from 'aws-cdk-lib/aws-dynamodb';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import { IKey, Key } from 'aws-cdk-lib/aws-kms';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { addSetting } from './settings.js';

type _DynamoDBTableProps = Omit<
  TableProps,
  'tableName' | 'partitionKey' | 'sortKey' | 'encryption' | 'encryptionKey'
>;

export interface DynamoDBTableProps extends _DynamoDBTableProps {
  /**
   * The DynamoDB table name. If omitted, CDK auto-generates a unique name
   * from the stack name and construct path.
   */
  readonly tableName?: string;

  /**
   * Deploy-time setting key used under the `dynamodb` namespace.
   */
  readonly runtimeConfigKey: string;

  /**
   * Server-side encryption for the table.
   *
   * @default TableEncryption.CUSTOMER_MANAGED
   */
  readonly encryption?: TableEncryption;

  /**
   * KMS key used to encrypt the table. Only used when `encryption` is
   * `TableEncryption.CUSTOMER_MANAGED`. When not provided, a new key is created.
   */
  readonly encryptionKey?: IKey;

  /**
   * Whether to enable automatic key rotation on the KMS key used to encrypt the table.
   *
   * @default true
   */
  readonly enableKeyRotation?: boolean;
}

export abstract class DynamoDBTable extends Construct {
  public readonly table: Table;
  private readonly runtimeConfigKey: string;

  constructor(
    scope: Construct,
    id: string,
    {
      tableName,
      runtimeConfigKey,
      billingMode = BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification = { pointInTimeRecoveryEnabled: true },
      deletionProtection = true,
      removalPolicy = RemovalPolicy.RETAIN,
      encryption = TableEncryption.CUSTOMER_MANAGED,
      encryptionKey,
      enableKeyRotation = true,
      ...rest
    }: DynamoDBTableProps,
  ) {
    super(scope, id);
    this.runtimeConfigKey = runtimeConfigKey;

    const key: IKey | undefined =
      encryption === TableEncryption.CUSTOMER_MANAGED
        ? (encryptionKey ??
          new Key(this, 'EncryptionKey', { enableKeyRotation, removalPolicy }))
        : undefined;

    this.table = new Table(this, runtimeConfigKey, {
      ...rest,
      ...(tableName !== undefined && { tableName }),
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode,
      pointInTimeRecoverySpecification,
      deletionProtection,
      encryptionKey: key,
      encryption,
      removalPolicy,
    });
  }

  /** Gives `fn` the table's name as its deploy-time `dynamodb` setting. */
  public bindSettings(fn: LambdaFunction): void {
    addSetting(fn, 'dynamodb', this.runtimeConfigKey, {
      tableName: this.table.tableName,
    });
  }

  public grantReadData(grantee: IGrantable): Grant {
    return this.table.grantReadData(grantee);
  }

  public grantWriteData(grantee: IGrantable): Grant {
    return this.table.grantWriteData(grantee);
  }

  public grantReadWriteData(grantee: IGrantable): Grant {
    return this.table.grantReadWriteData(grantee);
  }

  public grantFullAccess(grantee: IGrantable): Grant {
    return this.table.grantFullAccess(grantee);
  }

  public grantStreamRead(grantee: IGrantable): Grant {
    return this.table.grantStreamRead(grantee);
  }

  public grantTableListStreams(grantee: IGrantable): Grant {
    return this.table.grantTableListStreams(grantee);
  }

  public grant(grantee: IGrantable, ...actions: string[]): Grant {
    return this.table.grant(grantee, ...actions);
  }

  public grantStream(grantee: IGrantable, ...actions: string[]): Grant {
    return this.table.grantStream(grantee, ...actions);
  }
}
