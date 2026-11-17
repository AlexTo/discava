/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  LOCAL_QUEUES,
  localFeatureFailureQueueName,
  localFeatureQueueName,
} from '@discava/common-server-utils/local-dev';
import type { StreamFeature } from '@discava/core-table';

/**
 * ElasticMQ's config (HOCON, 1.x camelCase keys, which 2.x still reads): for
 * each registered stream feature a queue that moves a message to the
 * feature's failure queue after its `maxReceiveCount` receives, and the
 * router's failure queue. Queues are created on start, so `pnpm dev` needs no
 * setup step.
 */
export const elasticMqConfig = (features: readonly StreamFeature[]): string => {
  const visibility = `${LOCAL_QUEUES.visibilityTimeoutSeconds} seconds`;
  const queue = (name: string, extra = '') =>
    `  "${name}" {\n    defaultVisibilityTimeout = ${visibility}\n${extra}  }\n`;
  return [
    'include classpath("application.conf")',
    `node-address { protocol = http, host = "*", port = ${LOCAL_QUEUES.port}, context-path = "" }`,
    `rest-sqs { enabled = true, bind-port = ${LOCAL_QUEUES.port}, bind-hostname = "0.0.0.0", sqs-limits = strict }`,
    'queues {',
    queue(LOCAL_QUEUES.routerFailureQueue).trimEnd(),
    ...features.flatMap((feature) => [
      queue(localFeatureFailureQueueName(feature.name)).trimEnd(),
      queue(
        localFeatureQueueName(feature.name),
        `    deadLettersQueue { name = "${localFeatureFailureQueueName(feature.name)}", maxReceiveCount = ${feature.maxReceiveCount} }\n`,
      ).trimEnd(),
    ]),
    '}',
    '',
  ].join('\n');
};
