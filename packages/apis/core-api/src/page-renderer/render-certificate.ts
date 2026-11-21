/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IVerifyCertificateOutput } from '../schema/index.js';
import { buildHead, type PageContext, type RenderedPage } from './page.js';

/**
 * A certificate's verification page for crawlers: only what the page itself
 * shows, so a shared link previews well. The page is never indexed.
 */
export const renderCertificatePage = (
  context: PageContext,
  certificate: IVerifyCertificateOutput,
): RenderedPage => ({
  head: buildHead(context, {
    title: `${certificate.learnerName} completed ${certificate.courseTitle}`,
    description: `Certificate of completion, ${certificate.completedOn}. Issued by ${context.siteName}. Certificate ID ${certificate.certificateId}.`,
    path: `/certificates/${certificate.certificateId}`,
    type: 'website',
    noindex: true,
  }),
  root: '',
  pageData: '',
});
