/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOCAL_OIDC, LOCAL_S3 } from '@discava/common-server-utils/local-dev';

// Deletes local dev's data, for a fresh start: DynamoDB local's table and
// S3Mock's objects (their containers and named volumes), and the event
// runner's working files in tmp/local-dev/. Stop `pnpm dev` first. Nothing
// deployed is touched. Each service creates itself afresh on the next
// `pnpm dev`.

const dynamodb = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../databases/core-table/config.json', import.meta.url),
    ),
    'utf-8',
  ),
).localDev as { containerName: string };

const docker = (args: string[]) =>
  spawnSync('docker', args, { encoding: 'utf-8' });

if (docker(['info']).status !== 0) {
  console.error("Docker isn't running; start it and try again.");
  process.exit(1);
}

for (const container of [
  dynamodb.containerName,
  LOCAL_S3.containerName,
  LOCAL_OIDC.containerName,
]) {
  if (docker(['rm', '--force', container]).status === 0) {
    console.log(`Removed container ${container}`);
  }
}
// The containers' volumes, as their start scripts name them.
for (const volume of [
  `${dynamodb.containerName}-data`,
  `${LOCAL_S3.containerName}-data`,
]) {
  const result = docker(['volume', 'rm', volume]);
  console.log(
    result.status === 0
      ? `Deleted volume ${volume}`
      : `No volume ${volume} (${result.stderr.trim()})`,
  );
}

const localDevFiles = fileURLToPath(
  new URL('../../../../../tmp/local-dev', import.meta.url),
);
rmSync(localDevFiles, { recursive: true, force: true });
console.log(`Cleared ${localDevFiles}`);
console.log('Local data reset. `pnpm dev` starts afresh.');
