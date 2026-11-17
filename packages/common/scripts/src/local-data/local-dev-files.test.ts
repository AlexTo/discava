/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearLocalDevFiles } from './local-dev-files.js';

describe('clearLocalDevFiles', () => {
  const root = mkdtempSync(join(tmpdir(), 'local-dev-'));
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('removes the sent emails and the transcode files', () => {
    const dir = join(root, 'local-dev');
    mkdirSync(join(dir, 'emails'), { recursive: true });
    mkdirSync(join(dir, 'transcode'), { recursive: true });
    writeFileSync(join(dir, 'emails', 'a.json'), '{}');
    clearLocalDevFiles(dir);
    expect(existsSync(join(dir, 'emails'))).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });

  it('does nothing when there are no files', () => {
    expect(() => clearLocalDevFiles(join(root, 'missing'))).not.toThrow();
  });
});
