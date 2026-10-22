/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import React, {
  createContext,
  PropsWithChildren,
  useEffect,
  useState,
} from 'react';
import { Spinner } from '../spinner';

// Consider specifying types if desired
export type IRuntimeConfig = any;

/**
 * Context for storing the runtimeConfig.
 */
export const RuntimeConfigContext = createContext<IRuntimeConfig | undefined>(
  undefined,
);

/**
 * Apply any overrides to point to local servers/resources here
 * for the dev target
 */
const applyOverrides = (runtimeConfig: IRuntimeConfig) => {
  if (import.meta.env.MODE === 'local-dev') {
    // Sign in with the local OIDC server instead of dev Cognito (#226; port,
    // issuer and client from common-server-utils' LOCAL_OIDC), unless
    // VITE_LOCAL_AUTH=cognito.
    if (import.meta.env.VITE_LOCAL_AUTH !== 'cognito') {
      runtimeConfig.oidc = {
        authority: 'http://localhost:9400/discava',
        clientId: 'local',
      };
    }
    runtimeConfig.apis.CoreApi = 'http://localhost:2022/';
    // Course images come from S3Mock, which stands in for S3 in local dev
    // (#137; port and bucket from common-server-utils' LOCAL_S3).
    runtimeConfig.media = {
      ...runtimeConfig.media,
      PublicMediaBucket: 'http://localhost:9090/discava-public-media/',
    };
  }
  return runtimeConfig;
};

/**
 * Sets up the runtimeConfig.
 *
 * This assumes a runtime-config.json file is present at '/'.
 */
const RuntimeConfigProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [runtimeConfig, setRuntimeConfig] = useState<
    IRuntimeConfig | undefined
  >();
  useEffect(() => {
    (async () => {
      try {
        setRuntimeConfig(
          applyOverrides(await (await fetch('/runtime-config.json')).json()),
        );
      } catch {
        setRuntimeConfig(
          applyOverrides({ apis: {}, agentRuntimes: {} } as any),
        );
      }
    })();
  }, [setRuntimeConfig]);

  return runtimeConfig ? (
    <RuntimeConfigContext.Provider value={runtimeConfig}>
      {children}
    </RuntimeConfigContext.Provider>
  ) : (
    <Spinner />
  );
};

export default RuntimeConfigProvider;
