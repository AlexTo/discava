/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as portal from '@discava/common-web-utils/discussion';
import {
  DISCUSSION_BODY_MAX,
  DISCUSSION_MAX_VISIBLE_REPLIES,
  DISCUSSION_TITLE_MAX,
} from '@discava/core-table';
import { describe, expect, it } from 'vitest';

describe('discussion limits shared with the portals', () => {
  it("equal core-table's constants", () => {
    expect(portal.DISCUSSION_TITLE_MAX).toBe(DISCUSSION_TITLE_MAX);
    expect(portal.DISCUSSION_BODY_MAX).toBe(DISCUSSION_BODY_MAX);
    expect(portal.DISCUSSION_MAX_VISIBLE_REPLIES).toBe(
      DISCUSSION_MAX_VISIBLE_REPLIES,
    );
  });
});
