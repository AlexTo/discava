/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AttributeType,
  ProjectionType,
  StreamViewType,
} from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { DynamoDBTable, DynamoDBTableProps } from '../../core/dynamodb.js';
import { findWorkspaceRoot } from '../../core/workspace.js';

const { runtimeConfigKey, tableConfig } = JSON.parse(
  readFileSync(
    join(
      findWorkspaceRoot(fileURLToPath(new URL(import.meta.url))),
      'packages/databases/core-table/config.json',
    ),
    'utf-8',
  ),
) as {
  runtimeConfigKey: string;
  tableConfig: {
    globalSecondaryIndexes: {
      indexName: string;
      partitionKey: string;
      sortKey?: string;
    }[];
  };
};

export type CoreTableProps = Omit<DynamoDBTableProps, 'runtimeConfigKey'>;

export class CoreTable extends DynamoDBTable {
  constructor(scope: Construct, id: string, props?: CoreTableProps) {
    super(scope, id, {
      // The progress recalculation reads the stream. It needs both images:
      // the old one for a removed record, and both to tell whether what
      // students see (visibility, archivedAt) changed.
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      ...props,
      runtimeConfigKey,
    });

    for (const gsi of tableConfig.globalSecondaryIndexes) {
      this.table.addGlobalSecondaryIndex({
        indexName: gsi.indexName,
        partitionKey: { name: gsi.partitionKey, type: AttributeType.STRING },
        ...(gsi.sortKey && {
          sortKey: { name: gsi.sortKey, type: AttributeType.STRING },
        }),
        projectionType: ProjectionType.ALL,
      });
    }
  }
}
