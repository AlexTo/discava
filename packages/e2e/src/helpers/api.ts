/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { AppRouter as AdminApi } from '@discava/admin-api';
import type { AppRouter as CoreApi } from '@discava/core-api';
import {
  createCoreTableService,
  ensureInstructorProfile,
} from '@discava/core-table';
import type { AppRouter as InstructorApi } from '@discava/instructor-api';
import { createTRPCClient, httpLink } from '@trpc/client';
import { SERVICES } from './portals.js';
import { newUser, type Role } from './users.js';
import { THREE_SECOND_VIDEO } from './video.js';

// Calling the APIs directly, as a portal would but without a browser, for
// what a page can't do: firing requests at the same moment (see
// src/concurrency/).

const ISSUER = 'http://localhost:9400/discava';
const REDIRECT_URI = 'http://localhost/e2e';

// Signs in on the local OIDC server as a new user, the way its "Someone else"
// form does, and returns their access token.
const accessTokenFor = async (roles: Role[], givenName: string) => {
  const user = newUser(givenName, roles);
  return accessTokenForClaims(user.username, {
    sub: randomUUID(),
    username: user.username,
    email: user.email,
    email_verified: true,
    given_name: user.givenName,
    family_name: user.familyName,
    name: `${user.givenName} ${user.familyName}`,
    'cognito:groups': roles,
  });
};

// Signs in with the claims the local OIDC page would send for `username`.
export const accessTokenForClaims = async (
  username: string,
  claims: Record<string, unknown>,
) => {
  const authorize = `${ISSUER}/authorize?${new URLSearchParams({
    client_id: 'e2e',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid',
    state: 'e2e',
  })}`;
  const signIn = await fetch(authorize, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({
      username,
      claims: JSON.stringify(claims),
    }),
  });
  const code = new URL(signIn.headers.get('location') ?? '').searchParams.get(
    'code',
  );
  if (!code) {
    throw new Error(`The local OIDC server didn't sign in (${signIn.status})`);
  }
  const token = await fetch(`${ISSUER}/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: 'e2e',
      client_secret: 'e2e',
      redirect_uri: REDIRECT_URI,
    }),
  });
  const { access_token } = (await token.json()) as { access_token: string };
  return access_token;
};

// A new user, signed in, with a client for each API.
export const apiUser = async (givenName: string, roles: Role[]) =>
  apiClients(await accessTokenFor(roles, givenName));

export const apiClients = (accessToken: string) => {
  const headers = { authorization: `Bearer ${accessToken}` };
  // The user's id, from the token's claims.
  const { sub } = JSON.parse(
    Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString(),
  ) as { sub: string };
  return {
    sub,
    core: createTRPCClient<CoreApi>({
      links: [httpLink({ url: SERVICES.coreApi, headers })],
    }),
    instructor: createTRPCClient<InstructorApi>({
      links: [httpLink({ url: SERVICES.instructorApi, headers })],
    }),
    admin: createTRPCClient<AdminApi>({
      links: [httpLink({ url: SERVICES.adminApi, headers })],
    }),
  };
};

// Marks payments as connected to the local Stripe stand-in's first account,
// the state a price needs. It writes the record directly: admin-api's
// `payment.connect` needs the webhook address, which the local stack has no
// webhook API to give yet. A `put` replaces the record, so every scenario that
// needs it can call this at the same moment.
export const connectLocalPayments = async (
  webhookEndpointId = 'we_local',
  webhookUrl = 'http://localhost/stripe/webhook',
) => {
  const coreTable = await createCoreTableService();
  await coreTable.entities.paymentConnection
    .put({
      status: 'active',
      mode: 'test',
      accountId: 'acct_local',
      accountName: 'Local Stripe Account',
      keyLast4: 'ocal',
      webhookEndpointId,
      webhookUrl,
      revision: 1,
      changedBy: 'e2e',
      changedByName: 'End-to-end tests',
      changedAt: new Date().toISOString(),
    })
    .go();
};

// Connects payments for real against the local Stripe stand-in, the state a
// purchase needs: registers a webhook endpoint with it (as admin-api's connect
// does), saves the key and the endpoint's signing secret where the local
// secrets store reads them (`tmp/local-dev/secrets/`), and records the
// connection. `connectLocalPayments` alone leaves checkout without a key.
export const connectLocalStripe = async () => {
  const apiKey = 'sk_test_local';
  const runner = 'http://localhost:2024';
  const authorization = `Bearer ${apiKey}`;
  // A retried scenario must not leave an earlier endpoint behind: the stand-in
  // delivers every event to each endpoint, signed with that endpoint's secret.
  const existing = (await (
    await fetch(`${runner}/v1/webhook_endpoints`, {
      headers: { authorization },
    })
  ).json()) as { data?: { id: string }[] };
  for (const { id } of existing.data ?? []) {
    await fetch(`${runner}/v1/webhook_endpoints/${id}`, {
      method: 'DELETE',
      headers: { authorization },
    });
  }
  const response = await fetch(`${runner}/v1/webhook_endpoints`, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/x-www-form-urlencoded',
    },
    // The events the real registration asks for (`WEBHOOK_EVENTS`).
    body: new URLSearchParams({
      url: `${runner}/stripe/webhook`,
      'enabled_events[0]': 'checkout.session.completed',
      'enabled_events[1]': 'checkout.session.expired',
      'enabled_events[2]': 'charge.refunded',
    }),
  });
  if (!response.ok) {
    throw new Error(`The stand-in refused the endpoint: ${response.status}`);
  }
  const endpoint = (await response.json()) as { id: string; secret: string };

  const dir = fileURLToPath(
    new URL('../../../../tmp/local-dev/secrets/', import.meta.url),
  );
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(`${dir}stripe-api-key`, apiKey, { mode: 0o600 });
  await writeFile(`${dir}stripe-webhook-secret`, endpoint.secret, {
    mode: 0o600,
  });
  await connectLocalPayments(endpoint.id, `${runner}/stripe/webhook`);
};

export type ApiUser = Awaited<ReturnType<typeof apiUser>>;

const textBody = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

// A published course with one module and lesson holding two text items and
// a one-question quiz (pass mark 100%, two attempts), built through
// instructor-api.
export const createPublishedCourseViaApi = async (
  instructor: ApiUser,
  title: string,
) => {
  const api = instructor.instructor;
  const { courseId } = await api.course.create.mutate({ title });
  const { moduleId } = await api.module.create.mutate({
    courseId,
    title: 'Module 1',
  });
  const { lessonId } = await api.lesson.create.mutate({
    courseId,
    moduleId,
    title: 'Lesson 1',
  });
  const lesson = { courseId, moduleId, lessonId };
  const texts = [];
  for (const title of ['Reading 1', 'Reading 2']) {
    const { contentItemId } = await api.contentItem.createText.mutate({
      ...lesson,
      title,
      body: textBody(title),
    });
    texts.push({ ...lesson, contentItemId });
  }
  const { contentItemId: quizId } = await api.contentItem.createQuiz.mutate({
    ...lesson,
    title: 'Check',
    questions: [
      {
        questionId: 'q1',
        kind: 'single',
        prompt: textBody('One plus one?'),
        options: [
          { optionId: 'a', text: '2' },
          { optionId: 'b', text: '3' },
        ],
      },
    ],
    answerKey: { q1: { correctOptionIds: ['a'] } },
    settings: {
      passMarkPercent: 100,
      attemptsAllowed: 2,
      shuffleOptions: false,
      revealAnswers: 'never',
    },
  });
  await api.course.publish.mutate({ courseId });
  return { ...lesson, texts, quiz: { ...lesson, contentItemId: quizId } };
};

// A draft course with one lesson holding a video, uploaded and transcoded
// (locally, by ffmpeg in the event runner) until it is ready to play, and its
// automatic captions made. Returns the item's keys and its version's id.
export const createCaptionedVideoViaApi = async (
  instructor: ApiUser,
  title: string,
) => {
  const api = instructor.instructor;
  const { courseId } = await api.course.create.mutate({ title });
  const { moduleId } = await api.module.create.mutate({
    courseId,
    title: 'Module 1',
  });
  const { lessonId } = await api.lesson.create.mutate({
    courseId,
    moduleId,
    title: 'Lesson 1',
  });
  const lesson = { courseId, moduleId, lessonId };
  const target = await api.contentItem.createVideoUploadUrl.mutate({
    ...lesson,
    fileName: 'three-seconds.mp4',
  });
  const put = await fetch(target.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body: new Uint8Array(await readFile(THREE_SECOND_VIDEO)),
  });
  if (!put.ok) {
    throw new Error(`Uploading the video failed: ${put.status}`);
  }
  const item = { ...lesson, contentItemId: target.contentItemId };
  await api.contentItem.createVideo.mutate({
    ...item,
    title: 'Video',
    objectKey: target.objectKey,
    mimeType: 'video/mp4',
  });

  // Not found until transcoded; captions ready once Transcribe's stand-in has
  // made the automatic track, which would otherwise move the track list
  // under a test.
  let versionId = '';
  for (let attempt = 0; attempt < 120 && !versionId; attempt++) {
    const url = await api.contentItem.createVideoUrl
      .query(item)
      .catch(() => undefined);
    if (url?.captionsStatus === 'ready') {
      versionId = url.versionId;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (!versionId) {
    throw new Error('The video was not ready with captions in time');
  }
  return { ...item, versionId };
};

// Makes `instructor` a second instructor of the course, as the table keeps
// it (no API adds one yet).
export const addCourseInstructor = async (
  courseId: string,
  instructor: ApiUser,
) => {
  const coreTable = await createCoreTableService();
  const { data: course } = await coreTable.entities.course
    .get({ courseId })
    .go();
  if (!course) {
    throw new Error(`no course ${courseId}`);
  }
  // Every instructor has a profile (created with their first course).
  await ensureInstructorProfile(coreTable, instructor.sub);
  await coreTable.entities.courseInstructor
    .create({
      courseId,
      instructorId: instructor.sub,
      courseUpdatedAt: course.updatedAt,
    })
    .go();
};
