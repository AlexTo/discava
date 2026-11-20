/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { image } = JSON.parse(
  readFileSync(new URL('./config.json', import.meta.url), 'utf-8'),
).localDev;

if (
  spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' })
    .status !== 0
) {
  const pull = spawnSync('docker', ['pull', image], { stdio: 'inherit' });
  if (pull.status !== 0) process.exit(pull.status ?? 1);
}
