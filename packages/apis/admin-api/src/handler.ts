/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAllowedOrigin } from '@discava/common-server-utils/cors';
import {
  awsLambdaStreamingRequestHandler,
  CreateAWSLambdaContextOptions,
} from '@trpc/server/adapters/aws-lambda';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { appRouter } from './router.js';

export const handler = awslambda.streamifyResponse(
  awsLambdaStreamingRequestHandler({
    router: appRouter,
    createContext: (
      ctx: CreateAWSLambdaContextOptions<APIGatewayProxyEvent>,
    ) => ({ ...ctx, responseCookies: [] }),
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
