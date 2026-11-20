/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildLinkedInAddToProfileUrl,
  type LinkedInAddToProfileInput,
} from './linkedin-add-to-profile';

const input: LinkedInAddToProfileInput = {
  courseTitle: 'Linear Algebra',
  completedAt: '2026-10-05T12:00:00.000Z',
  certificateId: 'ABCD-EFGH-JKLM-NPQR',
  verifyUrl: 'https://learn.test/certificates/ABCD-EFGH-JKLM-NPQR',
  issuer: { name: 'Discava' },
};

const params = (url: string) => new URL(url).searchParams;

describe('buildLinkedInAddToProfileUrl', () => {
  it('builds the whole address for one certificate', () => {
    expect(buildLinkedInAddToProfileUrl(input)).toBe(
      'https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME' +
        '&name=Linear+Algebra&organizationName=Discava&issueYear=2026' +
        '&issueMonth=10&certUrl=https%3A%2F%2Flearn.test%2Fcertificates%2FABCD-EFGH-JKLM-NPQR' +
        '&certId=ABCD-EFGH-JKLM-NPQR',
    );
  });

  it('round-trips a title with &, #, accents and emoji', () => {
    const courseTitle = 'R&D #1: Café Économie 📈';
    const url = buildLinkedInAddToProfileUrl({ ...input, courseTitle });
    expect(params(url).get('name')).toBe(courseTitle);
  });

  it('gives the UTC month with no leading zero', () => {
    const url = buildLinkedInAddToProfileUrl({
      ...input,
      completedAt: '2026-11-30T23:30:00.000Z',
    });
    expect(params(url).get('issueMonth')).toBe('11');
    expect(params(url).get('issueYear')).toBe('2026');
    const march = buildLinkedInAddToProfileUrl({
      ...input,
      completedAt: '2026-03-01T00:00:00.000Z',
    });
    expect(params(march).get('issueMonth')).toBe('3');
  });

  it('sends the organisation ID instead of its name when there is one', () => {
    const p = params(
      buildLinkedInAddToProfileUrl({
        ...input,
        issuer: { name: 'Discava', linkedInOrganizationId: '12345' },
      }),
    );
    expect(p.get('organizationId')).toBe('12345');
    expect(p.has('organizationName')).toBe(false);
  });

  it('sends exactly the documented parameters', () => {
    expect(
      [...params(buildLinkedInAddToProfileUrl(input)).keys()].sort(),
    ).toEqual([
      'certId',
      'certUrl',
      'issueMonth',
      'issueYear',
      'name',
      'organizationName',
      'startTask',
    ]);
    expect(
      [
        ...params(
          buildLinkedInAddToProfileUrl({
            ...input,
            issuer: { name: 'Discava', linkedInOrganizationId: '1' },
          }),
        ).keys(),
      ].sort(),
    ).toEqual([
      'certId',
      'certUrl',
      'issueMonth',
      'issueYear',
      'name',
      'organizationId',
      'startTask',
    ]);
  });

  it('carries no learner name', () => {
    const url = buildLinkedInAddToProfileUrl(input);
    expect(url).not.toContain('Ada');
    expect(url).not.toContain('Lovelace');
  });
});
