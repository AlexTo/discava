/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LOCAL_S3 } from '@discava/common-server-utils/local-dev';
import { runLocalContainer } from '../local-container.js';

const { port, image, containerName, buckets } = LOCAL_S3;

// S3Mock stands in for S3 in local dev (#137). It creates the local buckets
// itself on start, keeps objects in a named volume so they survive restarts,
// and answers any origin's CORS requests, so the portals can upload to it
// and load from it directly.
runLocalContainer({
  containerEngine: 'docker',
  containerName,
  image,
  options: [
    '-p',
    `${port}:9090`,
    '-v',
    `${containerName}-data:/s3mockroot`,
    '-e',
    'COM_ADOBE_TESTING_S3MOCK_STORE_ROOT=/s3mockroot',
    '-e',
    'COM_ADOBE_TESTING_S3MOCK_STORE_RETAIN_FILES_ON_EXIT=true',
    '-e',
    `COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=${Object.values(buckets).join(',')}`,
  ],
});
