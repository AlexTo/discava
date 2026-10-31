/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import type { AppRouter as CoreApi } from '@discava/core-api';
import type { AppRouter as InstructorApi } from '@discava/instructor-api';
import { createTRPCClient, httpLink } from '@trpc/client';
import { SERVICES } from './portals.js';
import { newUser, type Role } from './users.js';

// Calling the APIs directly, as a portal would but without a browser, for
// what a page can't do: firing requests at the same moment (see
// src/concurrency/).

const ISSUER = 'http://localhost:9400/discava';
const REDIRECT_URI = 'http://localhost/e2e';

// Signs in on the local OIDC server as a new user, the way its "Someone else"
// form does, and returns their access token.
const accessTokenFor = async (roles: Role[], givenName: string) => {
  const user = newUser(givenName, roles);
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
      username: user.username,
      claims: JSON.stringify({
        sub: randomUUID(),
        username: user.username,
        email: user.email,
        email_verified: true,
        given_name: user.givenName,
        family_name: user.familyName,
        name: `${user.givenName} ${user.familyName}`,
        'cognito:groups': roles,
      }),
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
export const apiUser = async (givenName: string, roles: Role[]) => {
  const headers = {
    authorization: `Bearer ${await accessTokenFor(roles, givenName)}`,
  };
  return {
    core: createTRPCClient<CoreApi>({
      links: [httpLink({ url: SERVICES.coreApi, headers })],
    }),
    instructor: createTRPCClient<InstructorApi>({
      links: [httpLink({ url: SERVICES.instructorApi, headers })],
    }),
  };
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
