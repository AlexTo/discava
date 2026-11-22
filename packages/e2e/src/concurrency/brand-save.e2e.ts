/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { apiUser } from '../helpers/api.js';
import { currentBrand, restoreBrand } from '../helpers/branding.js';
import { expect, test } from '../helpers/table-invariants.js';
import { uniqueName } from '../helpers/users.js';

// The brand is one record for the stack. Two administrators who loaded the
// same revision and save at the same moment: the save is conditioned on the
// revision, so exactly one wins and the other is told to reload. Several
// rounds, each from the revision the previous winner left. The scenario
// restores the brand it found, so it runs serially with the branding scenario's
// own restore in mind (research R-13).
const ROUNDS = 5;

test('two administrators saving the same revision: exactly one wins', async () => {
  const admins = await Promise.all([
    apiUser('Una', ['admin']),
    apiUser('Dee', ['admin']),
  ]);
  const before = await currentBrand(admins[0]);

  try {
    for (let round = 1; round <= ROUNDS; round++) {
      const loaded = await currentBrand(admins[0]);
      const results = await Promise.allSettled(
        admins.map((admin, index) =>
          admin.admin.branding.save.mutate({
            expectedRevision: loaded.revision,
            ...loaded.brand,
            name: uniqueName(`Race ${round} admin ${index + 1}`).slice(0, 50),
          }),
        ),
      );

      expect(
        results.filter(({ status }) => status === 'fulfilled'),
        `round ${round}: one save wins`,
      ).toHaveLength(1);
      const [loss] = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      expect(loss?.reason).toMatchObject({
        data: { code: 'CONFLICT' },
        message:
          'Someone else changed the branding. Reload to see their changes.',
      });

      const saved = await currentBrand(admins[0]);
      expect(saved.revision, `round ${round}: revision rose by one`).toBe(
        loaded.revision + 1,
      );
    }
  } finally {
    await restoreBrand(admins[0], before);
  }
});
