/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';
import { syncIndices } from './sync-indices.js';

type OnEventResult = {
  PhysicalResourceId: string;
  Data?: Record<string, unknown>;
};

type SyncIndicesProperties = {
  endpoint: string;
  indices: {
    name: string;
    settings: Record<string, unknown>;
    mappings: Record<string, unknown>;
  }[];
};

// The SigV4-signed client for the deployed collection. This handler is only
// invoked on AWS (by the OpenSearch construct's Provider, and by a manual
// `aws lambda invoke` with a synthetic CFN-shaped payload), never locally, so
// it always signs with aoss; the local sync path is a separate script that
// talks to the container unsigned.
const getSignedClient = (endpoint: string) =>
  new Client({
    ...AwsSigv4Signer({
      region: process.env.AWS_REGION!,
      service: 'aoss',
      getCredentials: fromNodeProviderChain(),
    }),
    node: endpoint,
  });

// The CloudFormation custom resource handler. The construct's Provider passes
// the collection endpoint and the index manifest; a manifest-hash property
// forces a re-run whenever the manifest changes. On Delete it does nothing:
// indices are never removed by the sync (see syncIndices), so deleting the
// resource just removes the handler wiring, leaving the indices (and their
// data) in place.
export const handler = async (
  event: CloudFormationCustomResourceEvent,
): Promise<OnEventResult> => {
  const { endpoint, indices } =
    event.ResourceProperties as unknown as SyncIndicesProperties;

  if (event.RequestType !== 'Delete') {
    const { indexNames } = await syncIndices({
      client: getSignedClient(endpoint),
      indices,
    });
    return {
      PhysicalResourceId: endpoint,
      Data: { indexNames: indexNames.join(',') },
    };
  }

  return { PhysicalResourceId: endpoint };
};
