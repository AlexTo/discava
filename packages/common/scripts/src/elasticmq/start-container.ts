/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOCAL_QUEUES } from '@discava/common-server-utils/local-dev';
import { STREAM_FEATURES } from '@discava/core-table';
import { runLocalContainer } from '../local-container.js';
import { elasticMqConfig } from './config.js';

const { port, image, containerName } = LOCAL_QUEUES;

// ElasticMQ stands in for SQS in local dev: the stream router's queues and
// their failure queues. Its config is written from the stream feature
// registry into the repo's git-ignored tmp/ (so Docker can always mount it)
// and mounted, so the queues exist when it starts.
const configDir = fileURLToPath(
  new URL('../../../../../tmp/local-dev/elasticmq', import.meta.url),
);
mkdirSync(configDir, { recursive: true });
writeFileSync(`${configDir}/elasticmq.conf`, elasticMqConfig(STREAM_FEATURES));

runLocalContainer({
  containerEngine: 'docker',
  containerName,
  image,
  options: [
    '-p',
    `${port}:9324`,
    '-v',
    `${configDir}/elasticmq.conf:/opt/elasticmq.conf:ro`,
  ],
});
