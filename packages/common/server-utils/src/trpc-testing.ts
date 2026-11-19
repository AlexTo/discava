/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { type Mock, vi } from 'vitest';

// Test-only helpers for the three tRPC APIs' procedure tests. Imported by
// tests only, never by Lambda code.

export interface CallerOptions {
  /** The signed-in user's Cognito `sub`. Leave out to call anonymously. */
  sub?: string;
  /** The user's `cognito:groups` claim. */
  groups?: string[];
  /** Request headers, e.g. `{ origin }`. */
  headers?: Record<string, string>;
  /** Cookies the procedure may set on the response. */
  responseCookies?: string[];
}

interface Callable<Ctx, Caller> {
  createCaller: (ctx: Ctx) => Caller;
}

/** The API Gateway event a Cognito authorizer produces for `options`. */
export const buildEvent = ({
  sub,
  groups,
  headers,
}: CallerOptions = {}): APIGatewayProxyEvent =>
  ({
    ...(headers ? { headers } : {}),
    requestContext: sub
      ? {
          authorizer: {
            claims: {
              sub,
              ...(groups ? { 'cognito:groups': groups } : {}),
            },
          },
        }
      : {},
  }) as unknown as APIGatewayProxyEvent;

/**
 * A caller for `router` (from the API's `t.router({...})`) as the user in
 * `options`. With no `sub` there are no claims at all: an anonymous caller.
 */
export const callerFor = <Ctx, Caller>(
  router: Callable<Ctx, Caller>,
  options: CallerOptions = {},
): Caller =>
  router.createCaller({
    event: buildEvent(options),
    context: {} as any,
    info: {} as any,
    ...(options.responseCookies
      ? { responseCookies: options.responseCookies }
      : {}),
  } as unknown as Ctx);

type Camel<S extends string> = S extends `${infer A}.${infer B}`
  ? `${Capitalize<A>}${Camel<B>}`
  : Capitalize<S>;

/**
 * Which methods of each entity to mock, e.g.
 * `{ module: ['get', 'patch'], contentItem: ['query.primary'] }`. A
 * `transaction: ['write']` entry mocks `coreTable.transaction.write`.
 */
export type CoreTableSpec = Record<string, readonly string[]>;

export type CoreTableSpies<Spec extends CoreTableSpec> = {
  [E in keyof Spec & string as `${E}${Camel<Spec[E][number]>}`]: Mock;
};

const spyName = (entity: string, method: string) =>
  entity +
  method
    .split('.')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');

/**
 * Typed `vi.fn()` spies for the entity methods in `spec`, named
 * `<entity><Method>` (`moduleGet`, `contentItemQueryPrimary`,
 * `transactionWrite`), and `mockModule`, which builds the
 * `@discava/core-table` module replacement around them. Call it inside
 * `vi.hoisted` so `vi.mock` can see the spies:
 *
 * ```ts
 * const { courseGet, mockModule } = await vi.hoisted(async () =>
 *   (await import('@discava/common-server-utils/trpc-testing')).mockCoreTable({
 *     course: ['get'],
 *   }),
 * );
 * vi.mock('@discava/core-table', async (importOriginal) =>
 *   mockModule(await importOriginal()),
 * );
 * ```
 *
 * `mockModule(original, extras)` keeps the real exports, overrides them with
 * `extras` (core-table functions a test replaces) and swaps in a
 * `createCoreTableService` that returns the mocked entities.
 */
export const mockCoreTable = <const Spec extends CoreTableSpec>(
  spec: Spec,
): CoreTableSpies<Spec> & {
  mockModule: (
    original: object,
    extras?: Record<string, unknown>,
  ) => Record<string, unknown>;
} => {
  const spies: Record<string, Mock> = {};
  const entities: Record<string, any> = {};
  const transaction: Record<string, Mock> = {};
  for (const [entity, methods] of Object.entries(spec)) {
    for (const method of methods) {
      const spy = vi.fn();
      spies[spyName(entity, method)] = spy;
      if (entity === 'transaction') {
        transaction[method] = spy;
        continue;
      }
      let target = (entities[entity] ??= {});
      const path = method.split('.');
      for (const part of path.slice(0, -1)) {
        target = target[part] ??= {};
      }
      target[path[path.length - 1]!] = spy;
    }
  }
  const mockModule = (
    original: object,
    extras: Record<string, unknown> = {},
  ) => ({
    ...original,
    ...extras,
    createCoreTableService: vi.fn(async () => ({ entities, transaction })),
  });
  return { ...spies, mockModule } as any;
};

const TIMESTAMP = '2024-01-01T00:00:00.000Z';

/** A draft course by `instructor-1`, with the fields a test overrides. */
export const aCourse = <const O extends Record<string, unknown> = {}>(
  overrides: O = {} as O,
) => ({
  courseId: 'course-1',
  status: 'draft' as const,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  ...overrides,
});

export const aModule = <const O extends Record<string, unknown> = {}>(
  overrides: O = {} as O,
) => ({
  moduleId: 'module-1',
  courseId: 'course-1',
  title: 'Module',
  order: 1,
  visibility: 'visible' as const,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  ...overrides,
});

export const aLesson = <const O extends Record<string, unknown> = {}>(
  overrides: O = {} as O,
) => ({
  lessonId: 'lesson-1',
  moduleId: 'module-1',
  courseId: 'course-1',
  title: 'Welcome',
  order: 1,
  visibility: 'visible' as const,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  ...overrides,
});

/** A visible, ready content item in lesson-1; pass `type` and its fields. */
export const aContentItem = <const O extends Record<string, unknown> = {}>(
  overrides: O = {} as O,
) => ({
  contentItemId: 'content-item-1',
  lessonId: 'lesson-1',
  moduleId: 'module-1',
  courseId: 'course-1',
  type: 'video' as const,
  status: 'ready' as const,
  title: 'Intro video',
  order: 1,
  visibility: 'visible' as const,
  studentActivityCount: 0,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  ...overrides,
});
