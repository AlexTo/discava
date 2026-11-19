/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createCoreTableService } from '@discava/core-table';
import { initTRPC, TRPCError } from '@trpc/server';
import { CreateAWSLambdaContextOptions } from '@trpc/server/adapters/aws-lambda';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { Subsegment } from 'aws-xray-sdk-core';

export interface ICognitoUser {
  sub: string;
  email?: string;
  username?: string;
  groups: string[];
}

export interface IAuthContext {
  user?: ICognitoUser;
}

export const createAuthPlugin = () => {
  const t = initTRPC
    .context<
      IAuthContext & CreateAWSLambdaContextOptions<APIGatewayProxyEvent>
    >()
    .create();

  return t.procedure.use(async (opts) => {
    // In the deployed API, API Gateway's CognitoUserPoolsAuthorizer flattens every
    // claim to a string before it reaches the handler. Locally there's no API Gateway
    // (local-server.ts decodes the raw JWT payload itself), so claims keep their real
    // JSON types instead — e.g. `cognito:groups` is a string array, not a string.
    const claims = opts.ctx.event?.requestContext?.authorizer?.claims as
      | Record<string, unknown>
      | undefined;

    // CoreApi's authorizer accepts both ID and access tokens: ID tokens carry
    // `cognito:username` and `email`, access tokens carry plain `username` and
    // no email. `cognito:groups` is present on both.
    const user: ICognitoUser | undefined =
      typeof claims?.sub === 'string'
        ? {
            sub: claims.sub,
            email: asString(claims.email),
            username:
              asString(claims['cognito:username']) ?? asString(claims.username),
            groups: parseGroupsClaim(claims['cognito:groups']),
          }
        : undefined;

    return opts.next({
      ctx: {
        ...opts.ctx,
        user,
      },
    });
  });
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

// Deployed: `cognito:groups` arrives as a string, rendered either comma-separated
// ("a,b") or bracketed ("[a, b]") depending on the token type. Local: it arrives as
// a real string array straight from the decoded JWT. Normalise both to a string array.
const parseGroupsClaim = (groups: unknown): string[] => {
  if (Array.isArray(groups)) {
    return groups.filter((group): group is string => typeof group === 'string');
  }

  return typeof groups === 'string'
    ? groups
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((group) => group.trim())
        .filter(Boolean)
    : [];
};

export type ICoreTableContext = {
  coreTable?: Awaited<ReturnType<typeof createCoreTableService>>;
};

// Memoized across invocations on a warm Lambda so a request doesn't pay to
// rebuild every entity/service definition; the DynamoDB client and resolved
// table name it depends on are already memoized in @discava/core-table.
let coreTablePromise: ReturnType<typeof createCoreTableService> | undefined;

export const createCoreTablePlugin = () => {
  const t = initTRPC.context<ICoreTableContext>().create();

  return t.procedure.use(async (opts) => {
    if (!coreTablePromise) {
      coreTablePromise = createCoreTableService();
    }

    return opts.next({
      ctx: {
        ...opts.ctx,
        coreTable: await coreTablePromise,
      },
    });
  });
};

export const createErrorPlugin = () => {
  const t = initTRPC.context().create();
  return t.procedure.use(async (opts) => {
    const response = await opts.next({
      ctx: {
        ...opts.ctx,
      },
    });

    if (!response.ok) {
      if (response.error instanceof TRPCError) {
        throw response.error;
      }

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred, please try again later.',
        cause: response.error,
      });
    }

    return response;
  });
};

export interface ILoggerContext {
  logger?: Logger;
}

export const createLoggerPlugin = () => {
  const t = initTRPC.context<ILoggerContext>().create();
  return t.procedure.use(async (opts) => {
    const logger = new Logger();

    const response = await opts.next({
      ctx: {
        ...opts.ctx,
        logger,
      },
    });

    if (!response.ok) {
      logger.error('Unexpected error occured', response.error.cause ?? '');
    }

    return response;
  });
};

export interface IMetricsContext {
  metrics?: Metrics;
}

export const createMetricsPlugin = () => {
  const t = initTRPC.context<IMetricsContext>().create();
  const metrics = new Metrics();

  return t.procedure.use(async (opts) => {
    metrics.addDimensions({
      procedure: opts.path,
      type: opts.type,
    });
    metrics.captureColdStartMetric();
    metrics.addMetric('RequestCount', MetricUnit.Count, 1);

    try {
      const response = await opts.next({
        ctx: {
          ...opts.ctx,
          metrics,
        },
      });

      if (!response.ok) {
        metrics.addMetric('Failure', MetricUnit.Count, 1);
      } else {
        metrics.addMetric('Success', MetricUnit.Count, 1);
      }

      return response;
    } finally {
      metrics.publishStoredMetrics();
    }
  });
};

export interface ITracerContext {
  tracer?: Tracer;
}

export const createTracerPlugin = () => {
  const t = initTRPC.context<ITracerContext>().create();

  return t.procedure.use(async (opts) => {
    const tracer = new Tracer();
    const segment = tracer.getSegment();
    let handlerSegment: Subsegment | undefined;

    if (segment) {
      handlerSegment = segment.addNewSubsegment(`## ${opts.path}`);
      tracer.setSegment(handlerSegment);
    }

    tracer.annotateColdStart();
    tracer.addServiceNameAnnotation();

    try {
      const response = await opts.next({
        ctx: {
          ...opts.ctx,
          tracer,
        },
      });

      if (!response.ok && response.error.cause instanceof Error) {
        tracer.addErrorAsMetadata(response.error.cause);
      }
      return response;
    } finally {
      if (segment && handlerSegment) {
        handlerSegment.close();
        tracer.setSegment(segment);
      }
    }
  });
};

export interface IResponseCookiesContext {
  /**
   * Set-Cookie values a procedure wants on the response, emitted by the
   * handler's responseMeta. Kept out of procedure output so values meant to
   * be HttpOnly never reach the client's JS.
   */
  responseCookies?: string[];
}

export type IMiddlewareContext =
  CreateAWSLambdaContextOptions<APIGatewayProxyEvent> &
    IAuthContext &
    ICoreTableContext &
    ILoggerContext &
    IMetricsContext &
    ITracerContext &
    IResponseCookiesContext;
