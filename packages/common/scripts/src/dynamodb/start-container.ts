/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'fs';
import { runLocalContainer } from '../local-container.js';

const { containerEngine, containerName, image, port } = JSON.parse(
  readFileSync('config.json', 'utf-8'),
).localDev;

// Multiple dynamo table packages run dev in parallel sharing the same
// container (see runLocalContainer).
runLocalContainer({
  containerEngine,
  containerName,
  image,
  options: [
    '-u',
    'root',
    '-w',
    '/home/dynamodblocal',
    '-p',
    `${port}:${port}`,
    '-v',
    `${containerName}-data:/home/dynamodblocal/data`,
  ],
  command: [
    '-jar',
    'DynamoDBLocal.jar',
    '-sharedDb',
    '-dbPath',
    './data',
    '-port',
    `${port}`,
  ],
});
