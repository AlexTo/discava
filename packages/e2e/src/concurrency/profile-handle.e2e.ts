/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser } from '../helpers/api.js';
import { expect, test } from '../helpers/table-invariants.js';

// Two new instructors claiming the same handle at the same moment: the claim
// record is created with a "not exists" condition, so exactly one wins and the
// other is told the handle is taken. The invariant check afterwards confirms
// every profile has exactly one claim.
test('two new instructors claiming the same handle: exactly one gets it', async () => {
  const handle = `race-${Date.now().toString(36)}`;
  const instructors = await Promise.all([
    apiUser('Una', ['instructor']),
    apiUser('Dee', ['instructor']),
  ]);

  const results = await Promise.allSettled(
    instructors.map((instructor, index) =>
      instructor.instructor.profile.update.mutate({
        version: 0,
        displayName: `Racer ${index + 1}`,
        handle,
      }),
    ),
  );

  expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
    1,
  );
  const [loss] = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  expect(loss?.reason).toMatchObject({
    data: { code: 'CONFLICT' },
    message: 'That handle is taken',
  });

  // The winner's profile holds the handle; the loser has none to show.
  const saved = await Promise.all(
    instructors.map((instructor) => instructor.instructor.profile.get.query()),
  );
  expect(saved.filter((profile) => profile.version === 1)).toHaveLength(1);
  expect(saved.filter((profile) => profile.version === 1)[0]?.handle).toBe(
    handle,
  );
});
