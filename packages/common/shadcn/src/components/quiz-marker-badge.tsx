/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { QuestionMarker } from '@discava/common-web-utils/quiz';
import { Badge } from './ui/badge';

export function QuizMarkerBadge({ marker }: { marker?: QuestionMarker }) {
  if (!marker) {
    return null;
  }
  return (
    <Badge variant="secondary" className="text-xs">
      {marker === 'new' ? 'New' : 'Updated'}
    </Badge>
  );
}
