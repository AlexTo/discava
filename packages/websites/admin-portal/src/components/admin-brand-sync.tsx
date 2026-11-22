/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useSetBrand } from '@discava/common-web-utils/brand';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAdminApi } from '../api';

// The admin portal shows the saved brand from the API rather than waiting for
// the published copy, which the CDN may hold for a few minutes: the admin who
// just saved sees it at once. Renders nothing.
export function AdminBrandSync() {
  const trpc = useAdminApi();
  const setBrand = useSetBrand();
  const { data } = useQuery(trpc.branding.get.queryOptions());

  useEffect(() => {
    // Before the first save the saved brand is the default one: leave the
    // published copy (also the default) alone.
    if (data && data.revision > 0) {
      setBrand(data.brand);
    }
  }, [data, setBrand]);

  return null;
}
