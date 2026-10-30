/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'fs';
import { runLocalContainer } from '../local-container.js';

const { containerEngine, containerName, image, port } = JSON.parse(
  readFileSync('config.json', 'utf-8'),
).localDev;

// The container's own security plugin is off (DISABLE_SECURITY_PLUGIN): local
// dev talks to the container over plain HTTP with no credentials, matching the
// deployed collection's SigV4 (no basic auth). It is a single node, so it skips
// the multi-node discovery settings the bootstrap checks would otherwise demand
// (and bootstrap.memory_lock is off: a dev container doesn't need locked pages,
// and requiring a memlock ulimit would stop it starting on most machines). The
// JVM heap is halved, as OpenSearch's docs recommend for local use.
runLocalContainer({
  containerEngine,
  containerName,
  image,
  options: [
    '-p',
    `${port}:${port}`,
    '-e',
    'DISABLE_SECURITY_PLUGIN=true',
    '-e',
    'OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g',
    '-e',
    'discovery.type=single-node',
  ],
  command: [],
});
