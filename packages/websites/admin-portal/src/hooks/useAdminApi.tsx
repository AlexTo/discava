/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useContext } from 'react';
import {
  AdminApiTRPCContext,
  type AdminApiTRPCContextValue,
} from '../components/AdminApiClientProvider';

export const useAdminApi = (): AdminApiTRPCContextValue['optionsProxy'] => {
  const container = useContext(AdminApiTRPCContext);
  if (!container) {
    throw new Error('useAdminApi must be used within AdminApiClientProvider');
  }
  return container.optionsProxy;
};

export const useAdminApiClient = (): AdminApiTRPCContextValue['client'] => {
  const container = useContext(AdminApiTRPCContext);
  if (!container) {
    throw new Error(
      'useAdminApiClient must be used within AdminApiClientProvider',
    );
  }
  return container.client;
};
