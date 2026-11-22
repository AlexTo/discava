/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useState } from 'react';
import { useCoreApiClient } from '../api';
import { AddToLinkedInButton } from './add-to-linkedin-button';

// How a learner is told why a certificate was revoked.
const REVOCATION_REASON_LABEL = {
  'academic-integrity': 'Academic integrity',
  'issued-in-error': 'Issued in error',
  refunded: 'Order refunded',
  other: 'Other',
} as const;

export type RevocationReason = keyof typeof REVOCATION_REASON_LABEL;

// A date as the PDF and the public page print it: UTC, e.g. `19 November 2026`.
const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** "Certificate revoked on <date>. Reason: <category>." */
export const revokedText = (
  revokedAt: string,
  reason: RevocationReason | undefined,
) =>
  `Certificate revoked on ${formatDate(revokedAt)}.${
    reason ? ` Reason: ${REVOCATION_REASON_LABEL[reason]}.` : ''
  }`;

const certificatePath = (certificateId: string) =>
  `/certificates/${certificateId}`;

// Saves a base64-encoded file under `fileName`, as the browser does a link
// with a `download` attribute.
const saveBase64 = (fileName: string, contentBase64: string, type: string) => {
  const binary = atob(contentBase64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/**
 * What a student can do with the certificate for a course they completed:
 * view its public page, download it as a PDF, or copy its link, or add it to their LinkedIn profile.
 * A revoked certificate offers none of these, only what happened.
 */
export function CertificateActions({
  courseId,
  certificateId,
  courseTitle,
  completedAt,
  revokedAt,
  revocationReason,
}: {
  courseId: string;
  certificateId: string;
  courseTitle: string;
  completedAt: string;
  revokedAt?: string;
  revocationReason?: RevocationReason;
}) {
  const client = useCoreApiClient();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<unknown>();
  const [copied, setCopied] = useState(false);

  const download = async () => {
    setError(undefined);
    setPreparing(true);
    try {
      const { fileName, contentBase64 } = await client.certificate.pdf.query({
        courseId,
      });
      saveBase64(fileName, contentBase64, 'application/pdf');
    } catch (failure) {
      setError(failure);
    } finally {
      setPreparing(false);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(
      `${window.location.origin}${certificatePath(certificateId)}`,
    );
    setCopied(true);
  };

  if (revokedAt) {
    return (
      <p className="text-sm text-muted-foreground">
        {revokedText(revokedAt, revocationReason)}
      </p>
    );
  }

  return (
    <div className="space-y-2" role="group" aria-label="Certificate">
      <p className="text-sm font-medium">Certificate</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" asChild>
          <a
            href={certificatePath(certificateId)}
            target="_blank"
            rel="noreferrer"
          >
            View
          </a>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={preparing}
          onClick={() => void download()}
        >
          {preparing ? 'Preparing…' : 'Download PDF'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void copyLink()}>
          Copy link
        </Button>
        <AddToLinkedInButton
          certificate={{ certificateId, courseTitle, completedAt }}
          source="my-learning"
        />
        {copied ? (
          <span role="status" className="text-sm text-muted-foreground">
            Link copied
          </span>
        ) : null}
      </div>
      {error ? (
        <ErrorAlert type="error" header="Couldn't download your certificate">
          {apiErrorMessage(error)} Try again.
        </ErrorAlert>
      ) : null}
    </div>
  );
}
