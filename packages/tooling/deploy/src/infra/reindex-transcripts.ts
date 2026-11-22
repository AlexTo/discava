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
import {
  type InvokeReindex,
  parseReindexArgs,
  reindexUntilDone,
  type TranscriptReindexResult,
} from './transcript-reindex-loop.js';

const PROJECT_PATH = 'packages/infra';

const fail = (message: string): never => {
  console.error(`[reindex-transcripts] ${message}`);
  process.exit(1);
};

// Rebuilds the transcripts index, for one course or every course. Usage:
//   reindex-transcripts --stage=<stage> [--course=<courseId>]
// With --stage it invokes that stage's private transcript-reindex Lambda,
// found through the StreamRouter stack's resources, with the stage's
// credentials. With none it runs the rebuild in-process against the local
// stack (`pnpm dev`). Either way it calls again while a cursor comes back.
let args: ReturnType<typeof parseReindexArgs>;
try {
  args = parseReindexArgs(process.argv.slice(2));
} catch (error) {
  args = fail(
    `${(error as Error).message}. Usage: reindex-transcripts [--stage=<stage>] [--course=<courseId>]`,
  );
}

const invokeLambda = async (stage: string): Promise<InvokeReindex> => {
  const stageName = parseStageName(stage);
  if (!stageName) {
    return fail('--stage must be a stage name, e.g. discava-development');
  }
  const { credentials } = lookupCredentials(
    stagesConfig,
    PROJECT_PATH,
    stageName,
  );
  const env = credentials
    ? await buildChildEnv(credentials, PROJECT_PATH)
    : { ...process.env };

  const aws = (...awsArgs: string[]) => {
    const { status, stdout, stderr } = spawnSync('aws', awsArgs, {
      env,
      encoding: 'utf-8',
    });
    if (status !== 0) {
      fail(`aws ${awsArgs.slice(0, 2).join(' ')} failed: ${stderr.trim()}`);
    }
    return stdout.trim();
  };

  const functionName = aws(
    'cloudformation',
    'list-stack-resources',
    '--stack-name',
    `${stageName}-StreamRouter`,
    '--query',
    "StackResourceSummaries[?ResourceType=='AWS::Lambda::Function' && starts_with(LogicalResourceId,'TranscriptReindex')].PhysicalResourceId | [0]",
    '--output',
    'text',
  );
  if (!functionName || functionName === 'None') {
    return fail(
      `No transcript-reindex function found in ${stageName}-StreamRouter`,
    );
  }
  console.error(`[reindex-transcripts] Invoking ${functionName}`);

  return async (event) => {
    const dir = mkdtempSync(join(tmpdir(), 'reindex-transcripts-'));
    try {
      const out = join(dir, 'out.json');
      const meta = JSON.parse(
        aws(
          'lambda',
          'invoke',
          '--function-name',
          functionName,
          '--cli-binary-format',
          'raw-in-base64-out',
          '--payload',
          JSON.stringify(event),
          '--cli-read-timeout',
          '0',
          '--output',
          'json',
          out,
        ),
      ) as { FunctionError?: string };
      const payload = readFileSync(out, 'utf-8');
      if (meta.FunctionError) {
        return fail(`Lambda failed: ${payload}`);
      }
      return JSON.parse(payload) as TranscriptReindexResult;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
};

const invokeLocal = async (): Promise<InvokeReindex> => {
  process.env.LOCAL_DEV = 'true';
  // Loaded only now, so the handler sees LOCAL_DEV. By path in a variable:
  // this project doesn't depend on the events package, which is no library
  // (tsx runs the source), and the compiler must not follow it in.
  const handlerPath = '../../../../events/src/search/transcript-reindex.ts';
  const { transcriptReindex } = (await import(handlerPath)) as {
    transcriptReindex: (
      event: { courseId?: string; cursor?: string },
      context: { getRemainingTimeInMillis: () => number },
    ) => Promise<TranscriptReindexResult>;
  };
  return (event) =>
    transcriptReindex(event, { getRemainingTimeInMillis: () => 900_000 });
};

const invoke = args.stage
  ? await invokeLambda(args.stage)
  : await invokeLocal();
const totals = await reindexUntilDone(invoke, args.course);
console.log(JSON.stringify(totals));
