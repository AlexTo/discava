/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  BillingMode,
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  GlobalSecondaryIndexDescription,
  IndexStatus,
  KeyType,
  ProjectionType,
  ResourceInUseException,
  ScalarAttributeType,
  StreamViewType,
  TableStatus,
  UpdateTableCommand,
} from '@aws-sdk/client-dynamodb';
import { readFileSync } from 'fs';

const {
  localDev: { port, tableName },
  tableConfig: { globalSecondaryIndexes },
} = JSON.parse(readFileSync('config.json', 'utf-8')) as {
  localDev: { port: number; tableName: string };
  tableConfig: {
    globalSecondaryIndexes: {
      indexName: string;
      partitionKey: string;
      sortKey?: string;
    }[];
  };
};

const timeoutSignal = () => AbortSignal.timeout(10000);

// As the deployed table's: local dev's event runner (packages/events) reads it
// and hands changes to the same Lambda handlers (#137).
const STREAM_SPECIFICATION = {
  StreamEnabled: true,
  StreamViewType: StreamViewType.NEW_AND_OLD_IMAGES,
};

const client = new DynamoDBClient({
  endpoint: `http://localhost:${port}`,
  region: 'us-east-1',
  credentials: { accessKeyId: 'UNUSED', secretAccessKey: 'UNUSED' },
});

const waitForTableActive = async (
  waitClient: DynamoDBClient,
  waitTableName: string,
): Promise<void> => {
  for (;;) {
    const { Table } = await waitClient.send(
      new DescribeTableCommand({ TableName: waitTableName }),
      { abortSignal: timeoutSignal() },
    );
    const allActive =
      Table?.TableStatus === TableStatus.ACTIVE &&
      (Table?.GlobalSecondaryIndexes ?? []).every(
        (g: GlobalSecondaryIndexDescription) =>
          g.IndexStatus === IndexStatus.ACTIVE,
      );
    if (allActive) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

const ensureTable = async (
  tblClient: DynamoDBClient,
  tblName: string,
  gsIs: { indexName: string; partitionKey: string; sortKey?: string }[],
): Promise<void> => {
  const gsiAttributeDefinitions = gsIs.flatMap((gsi) => [
    { AttributeName: gsi.partitionKey, AttributeType: ScalarAttributeType.S },
    ...(gsi.sortKey
      ? [{ AttributeName: gsi.sortKey, AttributeType: ScalarAttributeType.S }]
      : []),
  ]);
  const attributeDefinitions = [
    { AttributeName: 'pk', AttributeType: ScalarAttributeType.S },
    { AttributeName: 'sk', AttributeType: ScalarAttributeType.S },
    ...gsiAttributeDefinitions.filter(
      (a, i, arr) =>
        arr.findIndex((b) => b.AttributeName === a.AttributeName) === i,
    ),
  ];
  const globalSecondaryIndexes = gsIs.map((gsi) => ({
    IndexName: gsi.indexName,
    KeySchema: [
      { AttributeName: gsi.partitionKey, KeyType: KeyType.HASH },
      ...(gsi.sortKey
        ? [{ AttributeName: gsi.sortKey, KeyType: KeyType.RANGE }]
        : []),
    ],
    Projection: { ProjectionType: ProjectionType.ALL },
  }));

  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      // New table: create with all GSIs in one shot.
      await tblClient.send(
        new CreateTableCommand({
          TableName: tblName,
          AttributeDefinitions: attributeDefinitions,
          KeySchema: [
            { AttributeName: 'pk', KeyType: KeyType.HASH },
            { AttributeName: 'sk', KeyType: KeyType.RANGE },
          ],
          BillingMode: BillingMode.PAY_PER_REQUEST,
          StreamSpecification: STREAM_SPECIFICATION,
          ...(globalSecondaryIndexes.length > 0 && {
            GlobalSecondaryIndexes: globalSecondaryIndexes,
          }),
        }),
        { abortSignal: timeoutSignal() },
      );
      console.log(`Created table: ${tblName}`);
      for (const gsi of globalSecondaryIndexes) {
        console.log(`Created GSI: ${gsi.IndexName}`);
      }
      return;
    } catch (e) {
      // Table already exists: sync GSIs to match desired state.
      if (e instanceof ResourceInUseException) {
        const { Table } = await tblClient.send(
          new DescribeTableCommand({ TableName: tblName }),
          { abortSignal: timeoutSignal() },
        );
        // A table from before local dev had a stream (#137): add it, so the
        // event runner sees changes without the table being recreated.
        if (!Table?.StreamSpecification?.StreamEnabled) {
          await tblClient.send(
            new UpdateTableCommand({
              TableName: tblName,
              StreamSpecification: STREAM_SPECIFICATION,
            }),
            { abortSignal: timeoutSignal() },
          );
          console.log(`Enabled stream on table: ${tblName}`);
          await waitForTableActive(tblClient, tblName);
        }
        const existingGSIs = Table?.GlobalSecondaryIndexes ?? [];
        const existingNames = new Set(
          existingGSIs.map(
            (g: GlobalSecondaryIndexDescription) => g.IndexName ?? '',
          ),
        );
        const desiredNames = new Set(gsIs.map((g) => g.indexName));

        // DynamoDB Local only allows one GSI to be created or deleted at a time.
        for (const existing of existingGSIs) {
          if (!existing.IndexName || desiredNames.has(existing.IndexName))
            continue;
          await tblClient.send(
            new UpdateTableCommand({
              TableName: tblName,
              GlobalSecondaryIndexUpdates: [
                { Delete: { IndexName: existing.IndexName } },
              ],
            }),
            { abortSignal: timeoutSignal() },
          );
          console.log(`Deleted GSI: ${existing.IndexName}`);
          await waitForTableActive(tblClient, tblName);
        }

        for (const gsi of gsIs) {
          if (existingNames.has(gsi.indexName)) continue;
          await tblClient.send(
            new UpdateTableCommand({
              TableName: tblName,
              AttributeDefinitions: [
                {
                  AttributeName: gsi.partitionKey,
                  AttributeType: ScalarAttributeType.S,
                },
                ...(gsi.sortKey
                  ? [
                      {
                        AttributeName: gsi.sortKey,
                        AttributeType: ScalarAttributeType.S,
                      },
                    ]
                  : []),
              ],
              GlobalSecondaryIndexUpdates: [
                {
                  Create: {
                    IndexName: gsi.indexName,
                    KeySchema: [
                      {
                        AttributeName: gsi.partitionKey,
                        KeyType: KeyType.HASH,
                      },
                      ...(gsi.sortKey
                        ? [
                            {
                              AttributeName: gsi.sortKey,
                              KeyType: KeyType.RANGE,
                            },
                          ]
                        : []),
                    ],
                    Projection: { ProjectionType: ProjectionType.ALL },
                  },
                },
              ],
            }),
            { abortSignal: timeoutSignal() },
          );
          console.log(`Created GSI: ${gsi.indexName}`);
          await waitForTableActive(tblClient, tblName);
        }
        return;
      }
      if (attempt === 29) throw e;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};

await ensureTable(client, tableName, globalSecondaryIndexes);
