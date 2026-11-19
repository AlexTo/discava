/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { callerFor } from '@discava/common-server-utils/trpc-testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../init.js';
import {
  createProfilePhotoUploadUrl,
  getProfile,
  updateProfile,
  updateProfilePhoto,
} from './profile.js';

const {
  profileGet,
  userGet,
  membershipsQuery,
  courseGet,
  transactionWrite,
  ensureProfile,
  writes,
  presignJpegUpload,
  headPublicMediaObject,
  attachPublicMediaObject,
  bestEffortDetachPublicMediaObject,
} = vi.hoisted(() => ({
  profileGet: vi.fn(),
  userGet: vi.fn(),
  membershipsQuery: vi.fn(),
  courseGet: vi.fn(),
  transactionWrite: vi.fn(),
  ensureProfile: vi.fn(),
  writes: { update: vi.fn(), changeHandle: vi.fn(), setPhoto: vi.fn() },
  presignJpegUpload: vi.fn(),
  headPublicMediaObject: vi.fn(),
  attachPublicMediaObject: vi.fn(),
  bestEffortDetachPublicMediaObject: vi.fn(),
}));

vi.mock('@discava/core-table', async (importActual) => ({
  ...(await importActual<typeof import('@discava/core-table')>()),
  ensureInstructorProfile: ensureProfile,
  instructorProfileWrites: writes,
  createCoreTableService: vi.fn(async () => ({
    entities: {
      instructorProfile: { get: profileGet },
      user: { get: userGet },
      courseInstructor: { query: { byInstructor: membershipsQuery } },
      course: { get: courseGet },
    },
    transaction: { write: transactionWrite },
  })),
}));

vi.mock('../helpers/public-media-client.js', () => ({
  presignJpegUpload,
  headPublicMediaObject,
  attachPublicMediaObject,
  bestEffortDetachPublicMediaObject,
}));

const router = t.router({
  get: getProfile,
  update: updateProfile,
  createPhotoUploadUrl: createProfilePhotoUploadUrl,
  updatePhoto: updateProfilePhoto,
});

const callAs = (groups: string[] = ['instructor']) =>
  callerFor(router, { sub: 'instructor-1', groups });

const profile = {
  instructorId: 'instructor-1',
  handle: 'alex-to',
  displayName: 'Alex To',
  headline: 'Teacher',
  version: 2,
  createdAt: 'a',
  updatedAt: 'b',
};
const NEW_PHOTO =
  'instructors/instructor-1/0f8fad5b-d9cb-469f-a165-70867728950e.jpg';
const OLD_PHOTO =
  'instructors/instructor-1/7c9e6679-7425-40de-944b-e07fc1f90ae7.jpg';

const input = {
  version: 2,
  displayName: ' Dr Alex ',
  headline: 'Teacher',
  bio: 'Hello',
  handle: 'Alex-Two',
};

// What the transaction callback built, and the result DynamoDB gives.
let built: unknown;
const cancelWith = (...codes: string[]) =>
  transactionWrite.mockImplementation((build: () => unknown) => ({
    go: async () => {
      built = build();
      return { canceled: true, data: codes.map((code) => ({ code })) };
    },
  }));

beforeEach(() => {
  vi.resetAllMocks();
  built = undefined;
  profileGet.mockReturnValue({ go: async () => ({ data: profile }) });
  userGet.mockReturnValue({
    go: async () => ({ data: { givenName: 'Alex', familyName: 'To' } }),
  });
  membershipsQuery.mockReturnValue({ go: async () => ({ data: [] }) });
  courseGet.mockReturnValue({ go: async () => ({ data: [] }) });
  transactionWrite.mockImplementation((build: () => unknown) => ({
    go: async () => {
      built = build();
      return { canceled: false, data: [] };
    },
  }));
  writes.update.mockReturnValue(['update']);
  writes.changeHandle.mockReturnValue(['changeHandle']);
  writes.setPhoto.mockReturnValue(['setPhoto']);
  presignJpegUpload.mockResolvedValue({ uploadUrl: 'u', headers: {} });
});

describe('profile.get', () => {
  it('returns the profile without internals, private by default', async () => {
    const result = await callAs().get();
    expect(result).toEqual({
      handle: 'alex-to',
      displayName: 'Alex To',
      headline: 'Teacher',
      version: 2,
      isPublic: false,
    });
  });

  it('is public when the caller teaches a published course', async () => {
    membershipsQuery.mockReturnValue({
      go: async () => ({
        data: [{ courseId: 'c1' }, { courseId: 'c2' }],
      }),
    });
    courseGet.mockReturnValue({
      go: async () => ({
        data: [{ status: 'draft' }, null, { status: 'published' }],
      }),
    });
    expect((await callAs().get()).isPublic).toBe(true);
  });

  it('is not public with only draft or archived courses', async () => {
    membershipsQuery.mockReturnValue({
      go: async () => ({ data: [{ courseId: 'c1' }, { courseId: 'c2' }] }),
    });
    courseGet.mockReturnValue({
      go: async () => ({
        data: [{ status: 'draft' }, { status: 'archived' }],
      }),
    });
    expect((await callAs().get()).isPublic).toBe(false);
  });

  it('returns a default with version 0 and writes nothing', async () => {
    profileGet.mockReturnValue({ go: async () => ({ data: null }) });

    expect(await callAs().get()).toEqual({
      handle: 'alex-to',
      displayName: 'Alex To',
      version: 0,
      isPublic: false,
    });
    expect(ensureProfile).not.toHaveBeenCalled();
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('reads only the caller’s profile', async () => {
    await callAs().get();
    expect(profileGet).toHaveBeenCalledWith({ instructorId: 'instructor-1' });
    expect(membershipsQuery).toHaveBeenCalledWith({
      instructorId: 'instructor-1',
    });
  });

  it('refuses a caller outside the instructor group', async () => {
    await expect(callAs(['student']).get()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('profile.update validation', () => {
  it.each([
    ['an empty display name', { displayName: '   ' }],
    ['a 61-character display name', { displayName: 'x'.repeat(61) }],
    ['a 101-character headline', { headline: 'x'.repeat(101) }],
    ['a 2001-character bio', { bio: 'x'.repeat(2001) }],
    ['a short handle', { handle: 'ab' }],
    ['a handle with a double hyphen', { handle: 'a--b' }],
    ['a handle with a space', { handle: 'a b' }],
    ['a reserved handle', { handle: 'Admin' }],
  ])('rejects %s before any read', async (_, change) => {
    await expect(
      callAs().update({ ...input, ...change }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(profileGet).not.toHaveBeenCalled();
  });

  it('accepts the limits', async () => {
    await callAs().update({
      ...input,
      displayName: 'x'.repeat(60),
      headline: 'x'.repeat(100),
      bio: 'x'.repeat(2000),
      handle: 'a'.repeat(30),
    });
    expect(writes.changeHandle).toHaveBeenCalled();
  });
});

describe('profile.update with version 0', () => {
  beforeEach(() => {
    profileGet.mockReturnValue({ go: async () => ({ data: profile }) });
  });

  it('creates the profile with the explicit handle', async () => {
    ensureProfile.mockResolvedValue({ status: 'created', handle: 'alex-two' });

    await callAs().update({ ...input, version: 0 });

    expect(ensureProfile).toHaveBeenCalledWith(
      expect.anything(),
      'instructor-1',
      {
        fields: { displayName: 'Dr Alex', headline: 'Teacher', bio: 'Hello' },
        handle: 'alex-two',
      },
    );
    expect(transactionWrite).not.toHaveBeenCalled();
  });

  it('gives CONFLICT when the handle is taken', async () => {
    ensureProfile.mockResolvedValue({ status: 'handle-taken' });
    await expect(
      callAs().update({ ...input, version: 0 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'That handle is taken',
    });
  });

  it('gives CONFLICT when a profile already exists', async () => {
    ensureProfile.mockResolvedValue({ status: 'exists' });
    await expect(
      callAs().update({ ...input, version: 0 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Your profile changed; reload and try again',
    });
  });
});

describe('profile.update of an existing profile', () => {
  it('updates in place when the handle is unchanged', async () => {
    await callAs().update({ ...input, handle: 'alex-to' });

    expect(writes.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        instructorId: 'instructor-1',
        version: 2,
        patch: { displayName: 'Dr Alex', headline: 'Teacher', bio: 'Hello' },
      }),
    );
    expect(writes.changeHandle).not.toHaveBeenCalled();
    expect(built).toEqual(['update']);
  });

  it('changes the handle in one transaction when it differs', async () => {
    await callAs().update(input);

    expect(writes.changeHandle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        instructorId: 'instructor-1',
        version: 2,
        from: 'alex-to',
        to: 'alex-two',
      }),
    );
    expect(writes.update).not.toHaveBeenCalled();
    expect(transactionWrite).toHaveBeenCalledTimes(1);
  });

  it('clears a headline and bio left out', async () => {
    await callAs().update({
      version: 2,
      displayName: 'A',
      handle: 'alex-to',
    });
    expect(writes.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        patch: { displayName: 'A', headline: '', bio: '' },
      }),
    );
  });

  it('gives CONFLICT "That handle is taken" for a failed new claim', async () => {
    cancelWith('ConditionalCheckFailed', 'None', 'None');
    await expect(callAs().update(input)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'That handle is taken',
    });
  });

  it.each([
    ['update', { ...input, handle: 'alex-to' }, ['ConditionalCheckFailed']],
    ['handle change', input, ['None', 'None', 'ConditionalCheckFailed']],
  ])('gives CONFLICT "reload" for a stale %s', async (_, body, codes) => {
    cancelWith(...codes);
    await expect(callAs().update(body)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Your profile changed; reload and try again',
    });
  });

  it('gives a retryable CONFLICT for a transaction conflict', async () => {
    cancelWith('TransactionConflict', 'None', 'None');
    await expect(callAs().update(input)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('retry'),
    });
  });

  it('gives CONFLICT when the profile does not exist but a version was sent', async () => {
    profileGet.mockReturnValue({ go: async () => ({ data: null }) });
    await expect(callAs().update(input)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('uses only the caller’s sub as the profile key', async () => {
    await callAs().update(input);
    expect(
      profileGet.mock.calls.every(([k]) => k.instructorId === 'instructor-1'),
    ).toBe(true);
    expect(writes.changeHandle.mock.calls[0][1].instructorId).toBe(
      'instructor-1',
    );
  });
});

describe('profile photo', () => {
  it('issues a key under the caller and presigns a JPEG upload', async () => {
    const result = await callAs().createPhotoUploadUrl({ contentLength: 1000 });

    expect(result.photoKey).toMatch(
      /^instructors\/instructor-1\/[0-9a-f-]{36}\.jpg$/,
    );
    expect(presignJpegUpload).toHaveBeenCalledWith(result.photoKey, 1000);
  });

  it.each([0, 2 * 1024 * 1024 + 1])('refuses a size of %s', async (size) => {
    await expect(
      callAs().createPhotoUploadUrl({ contentLength: size }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('attaches the uploaded photo and retires the previous one', async () => {
    profileGet.mockReturnValue({
      go: async () => ({ data: { ...profile, photoKey: OLD_PHOTO } }),
    });
    headPublicMediaObject.mockResolvedValue({
      contentType: 'image/jpeg',
      contentLength: 1000,
    });

    await callAs().updatePhoto({ photoKey: NEW_PHOTO });

    expect(attachPublicMediaObject).toHaveBeenCalledWith(NEW_PHOTO);
    expect(writes.setPhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        instructorId: 'instructor-1',
        photoKey: NEW_PHOTO,
      }),
    );
    expect(bestEffortDetachPublicMediaObject).toHaveBeenCalledWith(
      expect.anything(),
      OLD_PHOTO,
    );
  });

  it.each([
    [
      'another instructor’s key',
      'instructors/other/0f8fad5b-d9cb-469f-a165-70867728950e.jpg',
    ],
    ['a made-up key', 'instructors/instructor-1/../x.jpg'],
  ])('refuses %s without looking at S3', async (_, key) => {
    await expect(callAs().updatePhoto({ photoKey: key })).rejects.toMatchObject(
      { code: 'BAD_REQUEST' },
    );
    expect(headPublicMediaObject).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['not a JPEG', { contentType: 'image/png', contentLength: 10 }],
    ['too big', { contentType: 'image/jpeg', contentLength: 3 * 1024 * 1024 }],
  ])('refuses an upload that is %s', async (_, head) => {
    headPublicMediaObject.mockResolvedValue(head);
    await expect(
      callAs().updatePhoto({ photoKey: NEW_PHOTO }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(writes.setPhoto).not.toHaveBeenCalled();
  });

  it('removes the photo with null, without checking an upload', async () => {
    profileGet.mockReturnValue({
      go: async () => ({ data: { ...profile, photoKey: OLD_PHOTO } }),
    });

    await callAs().updatePhoto({ photoKey: null });

    expect(headPublicMediaObject).not.toHaveBeenCalled();
    expect(writes.setPhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ photoKey: null }),
    );
    expect(bestEffortDetachPublicMediaObject).toHaveBeenCalledWith(
      expect.anything(),
      OLD_PHOTO,
    );
  });

  it('asks for the profile to be saved first', async () => {
    profileGet.mockReturnValue({ go: async () => ({ data: null }) });
    await expect(
      callAs().updatePhoto({ photoKey: null }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('detaches the new photo when the write is cancelled', async () => {
    headPublicMediaObject.mockResolvedValue({
      contentType: 'image/jpeg',
      contentLength: 10,
    });
    cancelWith('ConditionalCheckFailed');

    await expect(
      callAs().updatePhoto({ photoKey: NEW_PHOTO }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(bestEffortDetachPublicMediaObject).toHaveBeenCalledWith(
      expect.anything(),
      NEW_PHOTO,
    );
  });
});
