/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { TableSnapshot } from './snapshot.js';
import { consistentTable, T, testHelpers } from './test-fixture.js';

let table: TableSnapshot;
beforeEach(() => {
  table = consistentTable();
});
const { broken, expectOnly } = testHelpers(() => table);

describe('instructor profiles', () => {
  const profile = () => table.instructorProfiles[0];

  it('passes a profile with its claim', () => {
    expect(broken().invariants).toEqual([]);
  });

  describe('instructor-has-profile', () => {
    it('reports a courseInstructor with no profile', () => {
      table.courseInstructors.push({
        courseId: 'c1',
        instructorId: 'other',
        courseUpdatedAt: T,
      });
      table.users.push({ userId: 'other' });
      expectOnly('instructor-has-profile', /no profile/);
    });
  });

  describe('profile-handle-claims-consistent', () => {
    it('reports an orphan claim', () => {
      table.profileHandleClaims.push({
        handle: 'gone',
        instructorId: 'nobody',
      });
      expectOnly(
        'profile-handle-claims-consistent',
        /no profile with that handle/,
      );
    });

    it('reports a claim owned by someone else', () => {
      table.profileHandleClaims = [
        { handle: 'the-teacher', instructorId: 'someone-else' },
      ];
      const { invariants, violations } = broken();
      expect(invariants).toEqual(['profile-handle-claims-consistent']);
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(/claimed by someone-else/),
      );
    });

    it('reports a profile whose handle has no claim', () => {
      table.profileHandleClaims = [];
      const { invariants, violations } = broken();
      expect(invariants).toEqual(['profile-handle-claims-consistent']);
      expect(violations.map((v) => v.message)).toContainEqual(
        expect.stringMatching(/no claim/),
      );
    });

    it('reports a claim for the old handle after a handle change', () => {
      profile().handle = 'new-handle';
      table.profileHandleClaims.push({
        handle: 'new-handle',
        instructorId: 'teacher',
      });
      expectOnly(
        'profile-handle-claims-consistent',
        /no profile with that handle/,
      );
    });
  });

  describe('instructor-profile-shape', () => {
    it('reports a 61-character display name', () => {
      profile().displayName = 'a'.repeat(61);
      expectOnly('instructor-profile-shape', /displayName is 61/);
    });

    it('reports an empty display name', () => {
      profile().displayName = '';
      expectOnly('instructor-profile-shape', /displayName is 0/);
    });

    it.each(['a--b', 'ab', '-ab-', 'Abc', 'a'.repeat(31)])(
      'reports the handle %s',
      (handle) => {
        profile().handle = handle;
        table.profileHandleClaims = [{ handle, instructorId: 'teacher' }];
        expectOnly('instructor-profile-shape', /not a valid handle/);
      },
    );

    it('reports a long headline and a long bio', () => {
      profile().headline = 'a'.repeat(101);
      profile().bio = 'a'.repeat(2001);
      const { invariants, violations } = broken();
      expect(invariants).toEqual(['instructor-profile-shape']);
      expect(violations).toHaveLength(2);
    });

    it('reports a version below 1', () => {
      profile().version = 0;
      expectOnly('instructor-profile-shape', /version is 0/);
    });
  });
});
