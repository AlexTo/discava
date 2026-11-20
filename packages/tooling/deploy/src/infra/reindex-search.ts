/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import stagesConfig from '@discava/common-infra-config';
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildChildEnv,
  lookupCredentials,
} from './stage-credentials/credentials.js';
import { parseStageName } from './stage-credentials/stage-parser.js';

const PROJECT_PATH = 'packages/infra';

const fail = (message: string): never => {
  console.error(`[reindex-search] ${message}`);
  process.exit(1);
};

// Re-indexes every published course on a deployed stage by invoking the
// private search-reindex Lambda (#273), found through the CoreApi stack's
// resources. Usage: reindex-search <stage>, e.g. discava-development.
const stageName = parseStageName(process.argv[2]);
if (!stageName) {
  fail('Usage: reindex-search <stage>, e.g. discava-development');
}

const { credentials } = lookupCredentials(
  stagesConfig,
  PROJECT_PATH,
  stageName!,
);
const env = credentials
  ? await buildChildEnv(credentials, PROJECT_PATH)
  : { ...process.env };

const aws = (...args: string[]) => {
  const { status, stdout, stderr } = spawnSync('aws', args, {
    env,
    encoding: 'utf-8',
  });
  if (status !== 0) {
    fail(`aws ${args.slice(0, 2).join(' ')} failed: ${stderr.trim()}`);
  }
  return stdout.trim();
};

const functionName = aws(
  'cloudformation',
  'list-stack-resources',
  '--stack-name',
  `${stageName}-CoreApi`,
  '--query',
  "StackResourceSummaries[?ResourceType=='AWS::Lambda::Function' && starts_with(LogicalResourceId,'SearchReindex')].PhysicalResourceId | [0]",
  '--output',
  'text',
);
if (!functionName || functionName === 'None') {
  fail(`No search-reindex function found in ${stageName}-CoreApi`);
}

console.error(`[reindex-search] Invoking ${functionName}`);
const dir = mkdtempSync(join(tmpdir(), 'reindex-search-'));
try {
  const out = join(dir, 'out.json');
  const meta = JSON.parse(
    aws(
      'lambda',
      'invoke',
      '--function-name',
      functionName,
      '--cli-read-timeout',
      '0',
      '--output',
      'json',
      out,
    ),
  ) as { FunctionError?: string };
  const payload = readFileSync(out, 'utf-8');
  if (meta.FunctionError) {
    fail(`Lambda failed: ${payload}`);
  }
  console.log(payload);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
