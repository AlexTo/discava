/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_PORTAL_ORIGINS,
  LOCAL_PORTAL_PORTS,
  LOCAL_PORTAL_PREVIEW_PORTS,
  type LocalPortal,
  localPortalOrigins,
} from './local-portals.js';

const PORTALS = ['instructor', 'student', 'admin'] as const;

describe('local portals', () => {
  it.each(PORTALS)("matches the %s portal's project.json port", (portal) => {
    const project = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          `../../../websites/${portal}-portal/project.json`,
        ),
        'utf8',
      ),
    );
    expect(project.metadata.ports).toEqual([LOCAL_PORTAL_PORTS[portal]]);
  });

  it('gives every portal its own port', () => {
    const ports = [
      ...Object.values(LOCAL_PORTAL_PORTS),
      ...Object.values(LOCAL_PORTAL_PREVIEW_PORTS),
    ];
    expect(new Set(ports).size).toBe(ports.length);
  });

  it('lists the dev and preview origin of each portal asked for', () => {
    const portals: LocalPortal[] = ['student', 'admin'];
    expect(localPortalOrigins(...portals)).toEqual([
      LOCAL_PORTAL_ORIGINS.student,
      'http://localhost:4301',
      LOCAL_PORTAL_ORIGINS.admin,
      'http://localhost:4302',
    ]);
  });
});
