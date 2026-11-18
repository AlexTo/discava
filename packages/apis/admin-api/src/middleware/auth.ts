/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initTRPC } from '@trpc/server';
import { CreateAWSLambdaContextOptions } from '@trpc/server/adapters/aws-lambda';
import type { APIGatewayProxyEvent } from 'aws-lambda';

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

    // AdminApi's authorizer accepts both ID and access tokens: ID tokens carry
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
