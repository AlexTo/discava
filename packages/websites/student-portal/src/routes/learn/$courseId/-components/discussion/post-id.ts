/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { newPostId } from '@discava/common-web-utils/discussion';
import { useState } from 'react';

// The id a form posts with: minted when the form opens, kept across failed
// attempts (so a retry cannot post twice) and renewed after a success.
export function usePostId() {
  const [postId, setPostId] = useState(() => newPostId());
  return [postId, () => setPostId(newPostId())] as const;
}
