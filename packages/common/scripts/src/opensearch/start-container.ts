/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'fs';
import { runLocalContainer } from '../local-container.js';

const { containerEngine, containerName, image, port } = JSON.parse(
  readFileSync('config.json', 'utf-8'),
).localDev;

// Single-node, security plugin disabled (local dev only -- it has no SigV4
// signing and no local equivalent of the collection's data access policy
// anyway), memory capped so it doesn't dominate a laptop running everything
// else in parallel (#53's "Local dev" scope note).
runLocalContainer({
  containerEngine,
  containerName,
  image,
  options: [
    '-p',
    `${port}:9200`,
    '-e',
    'discovery.type=single-node',
    '-e',
    'DISABLE_SECURITY_PLUGIN=true',
    '-e',
    'DISABLE_INSTALL_DEMO_CONFIG=true',
    '-e',
    'OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m',
    '-v',
    `${containerName}-data:/usr/share/opensearch/data`,
  ],
});
