/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AnyRouter } from '@trpc/server';
import {
  awsLambdaStreamingRequestHandler,
  CreateAWSLambdaContextOptions,
} from '@trpc/server/adapters/aws-lambda';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { getAllowedOrigin } from './cors.js';

/** The deployed Lambda entrypoint serving `router` behind API Gateway. */
export const createHandler = (router: AnyRouter) =>
  awslambda.streamifyResponse(
    awsLambdaStreamingRequestHandler({
      router,
      createContext: (
        ctx: CreateAWSLambdaContextOptions<APIGatewayProxyEvent>,
      ) => ({ ...ctx, responseCookies: [] as string[] }),
      responseMeta: ({ ctx }) => {
        const allowedOrigin = getAllowedOrigin(ctx?.event);
        return {
          headers: {
            ...(allowedOrigin && {
              'Access-Control-Allow-Origin': allowedOrigin,
              'Access-Control-Allow-Credentials': 'true',
            }),
            'Access-Control-Allow-Methods': '*',
            ...(ctx?.responseCookies?.length && {
              'set-cookie': ctx.responseCookies,
            }),
          },
        };
      },
    }),
  );
