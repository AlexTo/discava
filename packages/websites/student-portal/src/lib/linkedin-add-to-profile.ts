/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const LINKEDIN_ADD_TO_PROFILE_URL = 'https://www.linkedin.com/profile/add';

export interface LinkedInAddToProfileInput {
  // As printed on the certificate.
  courseTitle: string;
  // ISO, as printed on the certificate.
  completedAt: string;
  // Display form, XXXX-XXXX-XXXX-XXXX.
  certificateId: string;
  // Absolute: <origin>/certificates/<certificateId>.
  verifyUrl: string;
  issuer: { name: string; linkedInOrganizationId?: string };
}

// The address of LinkedIn's "Add to profile" form with a certificate's
// values filled in. Carries exactly these parameters and never anything about
// the learner: the name on the form is the learner's own LinkedIn name.
export const buildLinkedInAddToProfileUrl = ({
  courseTitle,
  completedAt,
  certificateId,
  verifyUrl,
  issuer,
}: LinkedInAddToProfileInput): string => {
  const completed = new Date(completedAt);
  const params = new URLSearchParams({ startTask: 'CERTIFICATION_NAME' });
  params.set('name', courseTitle);
  if (issuer.linkedInOrganizationId) {
    params.set('organizationId', issuer.linkedInOrganizationId);
  } else {
    params.set('organizationName', issuer.name);
  }
  params.set('issueYear', String(completed.getUTCFullYear()));
  params.set('issueMonth', String(completed.getUTCMonth() + 1));
  params.set('certUrl', verifyUrl);
  params.set('certId', certificateId);
  return `${LINKEDIN_ADD_TO_PROFILE_URL}?${params}`;
};
