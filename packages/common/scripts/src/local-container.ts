/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn, spawnSync } from 'child_process';

export interface LocalContainer {
  /** `docker`, or another engine with the same CLI. */
  readonly containerEngine: string;
  readonly containerName: string;
  readonly image: string;
  /** `run` options before the image: ports, volumes, environment. */
  readonly options: readonly string[];
  /** The image's command and arguments, if it needs any. */
  readonly command?: readonly string[];
}

/**
 * Runs a local dev service's container in the foreground for `nx dev`:
 * pulls the image if needed, starts the container (or reuses one already
 * running), streams its logs, and stops it on exit.
 *
 * Several projects' dev targets can share one container, so they all stream
 * its logs, but only the process that created it stops it on exit; the others
 * just detach.
 */
export const runLocalContainer = ({
  containerEngine,
  containerName,
  image,
  options,
  command = [],
}: LocalContainer): void => {
  const containerExists = (): boolean =>
    spawnSync(containerEngine, ['container', 'inspect', containerName], {
      stdio: 'ignore',
    }).status === 0;

  const isRunning = (): boolean => {
    const result = spawnSync(
      containerEngine,
      ['container', 'inspect', '-f', '{{.State.Running}}', containerName],
      { encoding: 'utf-8' },
    );
    return result.status === 0 && result.stdout.trim() === 'true';
  };

  // Ensure the image is available locally before starting the container.
  if (
    spawnSync(containerEngine, ['image', 'inspect', image], { stdio: 'ignore' })
      .status !== 0
  ) {
    const pull = spawnSync(containerEngine, ['pull', image], {
      stdio: 'inherit',
    });
    if (pull.status !== 0) process.exit(pull.status ?? 1);
  }

  let created = false;
  let runRetries = 0;
  for (;;) {
    if (containerExists()) {
      if (!isRunning()) {
        // Another process may have started it between our inspect and start — container engine start
        // exits 0 even if the container is already running, so no special-casing needed.
        const start = spawnSync(containerEngine, ['start', containerName], {
          stdio: 'inherit',
        });
        if (start.status !== 0) process.exit(start.status ?? 1);
      }
      break;
    }
    const runArgs = [
      'run',
      ...(containerEngine === 'docker' ? ['--rm'] : []),
      '--name',
      containerName,
      ...options,
      '-d',
      image,
      ...command,
    ];
    const create = spawnSync(containerEngine, runArgs, { stdio: 'pipe' });
    if (create.status === 0) {
      created = true;
      break;
    }
    if (!containerExists() && ++runRetries > 3) {
      process.stderr.write(create.stderr);
      process.exit(create.status ?? 1);
    }
  }

  const logs = spawn(containerEngine, ['logs', '-f', containerName], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  let exiting = false;
  const cleanup = () => {
    if (exiting) return;
    exiting = true;
    if (created) {
      if (containerEngine === 'docker') {
        spawnSync(containerEngine, ['stop', containerName], {
          stdio: 'ignore',
        });
      } else {
        spawnSync(containerEngine, ['rm', '-f', containerName], {
          stdio: 'ignore',
        });
      }
    }
    logs.kill();
    process.exit(0);
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGHUP', cleanup);
  logs.on('exit', cleanup);
};
