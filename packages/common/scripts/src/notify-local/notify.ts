/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createCoreTableService,
  notifyCourseStudents,
  publishNotification,
} from '@discava/core-table';
import { parseNotifyArgs } from './args.js';

// Publishes a notification to the local table, to try the bell and the email
// inbox without a producer. Usage:
//   pnpm nx run @discava/common-scripts:notify-local -- --user <sub> --type <id> [--param k=v]... [--key <dedupeKey>]
//   pnpm nx run @discava/common-scripts:notify-local -- --course <courseId> --type <id> ...
// `--user` calls publishNotification; `--course` calls notifyCourseStudents,
// which the event runner then fans out to the course's students. Needs
// `pnpm dev` running.
process.env.LOCAL_DEV = 'true';

let request: ReturnType<typeof parseNotifyArgs>;
try {
  request = parseNotifyArgs(process.argv.slice(2));
} catch (error) {
  console.error(`[notify-local] ${(error as Error).message}`);
  process.exit(1);
}

const coreTable = await createCoreTableService();
if ('userId' in request) {
  const outcome = await publishNotification(coreTable, request);
  console.log(
    `[notify-local] ${request.type} for ${request.userId} (key ${request.dedupeKey}): ${outcome}`,
  );
} else {
  const { canceled } = await coreTable.transaction
    .write(() => notifyCourseStudents(coreTable, request))
    .go();
  console.log(
    canceled
      ? `[notify-local] ${request.type} for course ${request.courseId} (key ${request.dedupeKey}) was already requested`
      : `[notify-local] ${request.type} requested for course ${request.courseId} (key ${request.dedupeKey})`,
  );
}
