/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { useBrand } from '@discava/common-web-utils/brand';
import { useRuntimeConfig } from '@discava/common-web-utils/runtime-config';
import { useCoreApiClient } from '../api';
import { buildLinkedInAddToProfileUrl } from '../lib/linkedin-add-to-profile';

type LinkedInSource = 'my-learning' | 'certificate-page';

/**
 * The address of LinkedIn's form for a certificate, issued by this site
 * (the brand's name, and `site` in the runtime config for a LinkedIn page).
 */
export const useLinkedInAddToProfileUrl = (certificate: {
  courseTitle: string;
  completedAt: string;
  certificateId: string;
}) => {
  const { site } = useRuntimeConfig();
  const brand = useBrand();
  return buildLinkedInAddToProfileUrl({
    ...certificate,
    verifyUrl: `${window.location.origin}/certificates/${certificate.certificateId}`,
    issuer: {
      name: brand.name,
      linkedInOrganizationId: site?.linkedInOrganizationId,
    },
  });
};

/**
 * "Add to LinkedIn profile": a link that opens LinkedIn's form with the
 * certificate's values, and records the use without waiting for it. A failed
 * record shows nothing.
 */
export function AddToLinkedInButton({
  certificate,
  source,
}: {
  certificate: {
    courseTitle: string;
    completedAt: string;
    certificateId: string;
  };
  source: LinkedInSource;
}) {
  const client = useCoreApiClient();
  const href = useLinkedInAddToProfileUrl(certificate);

  const record = () => {
    void Promise.resolve()
      .then(() =>
        client.certificate.recordLinkedInClick.mutate({
          certificateId: certificate.certificateId,
          source,
        }),
      )
      .catch(() => {});
  };

  return (
    <Button variant="outline" size="sm" asChild>
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={record}>
        Add to LinkedIn profile
      </a>
    </Button>
  );
}
