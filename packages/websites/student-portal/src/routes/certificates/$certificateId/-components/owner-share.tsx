/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useBrand } from '@discava/common-web-utils/brand';
import { AddToLinkedInButton } from '../../../../components/add-to-linkedin-button';

/**
 * What only the certificate's owner sees under it: the button that opens
 * LinkedIn's form, and the values to copy if it doesn't fill them in.
 */
export function OwnerShare({
  certificate,
}: {
  certificate: {
    certificateId: string;
    courseTitle: string;
    completedAt: string;
    completedOn: string;
  };
}) {
  const brand = useBrand();
  const [, month, year] = certificate.completedOn.split(' ');
  const values = [
    ['Name', certificate.courseTitle],
    ['Issuing organisation', brand.name],
    ['Issue date', `${month} ${year}`],
    ['Credential ID', certificate.certificateId],
    [
      'Credential URL',
      `${window.location.origin}/certificates/${certificate.certificateId}`,
    ],
  ];

  return (
    <section
      aria-label="Add to LinkedIn"
      className="mt-6 space-y-4 rounded-2xl border p-6"
    >
      <h2 className="text-lg font-semibold">
        Add this certificate to your LinkedIn profile
      </h2>
      <AddToLinkedInButton
        certificate={certificate}
        source="certificate-page"
      />
      <div className="space-y-2">
        <p className="text-sm font-medium">What LinkedIn asks for</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {values.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="text-xs text-muted-foreground">
        We can't see your LinkedIn profile, so this button stays here after
        you've used it.
      </p>
    </section>
  );
}
