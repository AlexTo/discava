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
 * Local dev's whole runtime config: everything runs locally (#137), so there's
 * no deployed stack's runtime-config.json to fetch.
 */
const LOCAL_DEV_CONFIG: IRuntimeConfig = {
  // Sign in with the local OIDC server instead of Cognito (#226; port, issuer
  // and client from common-server-utils' LOCAL_OIDC).
  localOidc: {
    authority: 'http://localhost:9400/discava',
    clientId: 'local',
  },
  // Where `pnpm dev` serves each portal, as the deployed config has their
  // addresses (#235).
  portals: {
    StudentPortal: 'http://localhost:4201',
    InstructorPortal: 'http://localhost:4200',
    AdminPortal: 'http://localhost:4202',
  },
  apis: {
    CoreApi: 'http://localhost:2022/',
    InstructorApi: 'http://localhost:2023/',
  },
  // Course images come from S3Mock, which stands in for S3 in local dev
  // (#137; port and bucket from common-server-utils' LOCAL_S3).
  media: {
    PublicMediaBucket: 'http://localhost:9090/discava-public-media/',
  },
};

/**
 * Sets up the runtimeConfig: in local-dev mode LOCAL_DEV_CONFIG, otherwise the
 * runtime-config.json the deployed stack serves at '/'.
 */
const RuntimeConfigProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [runtimeConfig, setRuntimeConfig] = useState<
    IRuntimeConfig | undefined
  >();
  useEffect(() => {
    if (import.meta.env.MODE === 'local-dev') {
      setRuntimeConfig(LOCAL_DEV_CONFIG);
      return;
    }
    (async () => {
      try {
        setRuntimeConfig(await (await fetch('/runtime-config.json')).json());
      } catch {
        setRuntimeConfig({ apis: {}, agentRuntimes: {} } as any);
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
