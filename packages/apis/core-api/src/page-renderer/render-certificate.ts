/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IVerifyCertificateOutput } from '../schema/index.js';
import { buildHead, type PageContext, type RenderedPage } from './page.js';

/**
 * A certificate's verification page for crawlers: only what the page itself
 * shows, so a shared link previews well. The page is never indexed. A revoked
 * certificate previews with its ID alone, as the page does.
 */
export const renderCertificatePage = (
  context: PageContext,
  certificate: IVerifyCertificateOutput,
): RenderedPage => ({
  head: buildHead(
    context,
    certificate.status === 'revoked'
      ? {
          title: 'Certificate revoked',
          description: `This certificate has been revoked and is no longer valid. Certificate ID ${certificate.certificateId}.`,
          path: `/certificates/${certificate.certificateId}`,
          type: 'website',
          noindex: true,
        }
      : {
          title: `${certificate.learnerName} completed ${certificate.courseTitle}`,
          description: `Certificate of completion, ${certificate.completedOn}. Issued by ${context.siteName}. Certificate ID ${certificate.certificateId}.`,
          path: `/certificates/${certificate.certificateId}`,
          type: 'website',
          noindex: true,
        },
  ),
  root: '',
  pageData: '',
});
