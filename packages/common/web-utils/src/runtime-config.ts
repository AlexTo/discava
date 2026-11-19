/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createContext,
  createElement,
  type FC,
  Fragment,
  type PropsWithChildren,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';

// Consider specifying types if desired
export type IRuntimeConfig = any;

/**
 * Context for storing the runtimeConfig.
 */
export const RuntimeConfigContext = createContext<IRuntimeConfig | undefined>(
  undefined,
);

export const useRuntimeConfig = (): IRuntimeConfig => {
  const runtimeConfig = useContext(RuntimeConfigContext);

  if (!runtimeConfig) {
    throw new Error(
      'useRuntimeConfig must be used within a RuntimeConfigProvider',
    );
  }

  return runtimeConfig;
};

export interface RuntimeConfigProviderProps extends PropsWithChildren {
  /**
   * The portal's whole runtime config in local-dev mode: everything runs
   * locally (#137), so there's no deployed stack's runtime-config.json to
   * fetch.
   */
  localDevConfig: IRuntimeConfig;
  /** Shown until the config has loaded. */
  fallback?: ReactNode;
}

/**
 * Sets up the runtimeConfig: in local-dev mode `localDevConfig`, otherwise the
 * runtime-config.json the deployed stack serves at '/'.
 */
export const RuntimeConfigProvider: FC<RuntimeConfigProviderProps> = ({
  localDevConfig,
  fallback = null,
  children,
}) => {
  const [runtimeConfig, setRuntimeConfig] = useState<
    IRuntimeConfig | undefined
  >();
  useEffect(() => {
    if (import.meta.env.MODE === 'local-dev') {
      setRuntimeConfig(localDevConfig);
      return;
    }
    (async () => {
      try {
        setRuntimeConfig(await (await fetch('/runtime-config.json')).json());
      } catch {
        setRuntimeConfig({ apis: {}, agentRuntimes: {} } as any);
      }
    })();
  }, [localDevConfig]);

  return runtimeConfig
    ? createElement(
        RuntimeConfigContext.Provider,
        { value: runtimeConfig },
        children,
      )
    : createElement(Fragment, null, fallback);
};

export default RuntimeConfigProvider;
