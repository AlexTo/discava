/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useBrand } from '@discava/common-web-utils/brand';
import { pageTitle } from '@discava/common-web-utils/page-title';
import { useEffect } from 'react';

/**
 * Sets `document.title` to the page's title whenever it changes. Nothing is
 * restored on unmount: the next page sets its own.
 */
export function usePageTitle(
  ...parts: (string | null | undefined | false)[]
): void {
  const { name } = useBrand();
  const title = pageTitle(name, ...parts);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
