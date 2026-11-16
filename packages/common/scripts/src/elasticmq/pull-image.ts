/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import { LOCAL_QUEUES } from '@discava/common-server-utils/local-dev';

const { image } = LOCAL_QUEUES;

if (
  spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' })
    .status !== 0
) {
  const pull = spawnSync('docker', ['pull', image], { stdio: 'inherit' });
  if (pull.status !== 0) process.exit(pull.status ?? 1);
}
