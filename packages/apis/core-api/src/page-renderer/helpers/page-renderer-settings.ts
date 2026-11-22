/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export interface PageRendererSettings {
  tableName: string;
  publicMediaBaseUrl: string;
}

/** The slice of the SSM client this module uses, so tests can fake it. */
export interface SettingsClient {
  send: (command: GetParameterCommand) => Promise<{
    Parameter?: { Value?: string };
  }>;
}

const read = async (client: SettingsClient): Promise<PageRendererSettings> => {
  const name = process.env.PAGE_RENDERER_PARAMETER;
  if (!name) {
    throw new Error('PAGE_RENDERER_PARAMETER environment variable is not set');
  }
  const { Parameter } = await client.send(
    new GetParameterCommand({ Name: name }),
  );
  let settings: Partial<PageRendererSettings>;
  try {
    settings = JSON.parse(Parameter?.Value ?? '') as typeof settings;
  } catch {
    throw new Error(`Parameter ${name} is not valid JSON`);
  }
  for (const field of ['tableName', 'publicMediaBaseUrl'] as const) {
    if (!settings[field]) {
      throw new Error(`Parameter ${name} has no ${field}`);
    }
  }
  return settings as PageRendererSettings;
};

let pending: Promise<PageRendererSettings> | undefined;
let defaultClient: SSMClient | undefined;

/**
 * Reads PAGE_RENDERER_PARAMETER's JSON once per instance; concurrent and later
 * calls share one promise. A failed read is forgotten, so the next call
 * retries.
 */
export const resolvePageRendererSettings = (
  client?: SettingsClient,
): Promise<PageRendererSettings> => {
  if (!pending) {
    const promise = read(
      client ??
        ((defaultClient ??= new SSMClient({})) satisfies SettingsClient),
    );
    pending = promise;
    promise.catch(() => {
      if (pending === promise) pending = undefined;
    });
  }
  return pending;
};

/** Forgets the cached read, for tests. */
export const resetPageRendererSettings = (): void => {
  pending = undefined;
};
