/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createFileRoute } from '@tanstack/react-router';
import { CertificatesScreen } from './-components/certificates-screen';
import { certificatesSearch } from './-search';

export const Route = createFileRoute('/certificates')({
  validateSearch: certificatesSearch,
  component: CertificatesScreen,
});
