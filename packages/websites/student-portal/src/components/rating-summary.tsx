/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Star } from 'lucide-react';

/**
 * A course's rating: "4.6", a star and "(128 ratings)", or "No ratings yet".
 * The star is a glyph beside the text, never the only label. Renders nothing
 * where the source doesn't carry ratings (`count` undefined).
 */
export function RatingSummary({
  average,
  count,
  className = '',
}: {
  average?: number;
  count?: number;
  className?: string;
}) {
  if (count === undefined) {
    return null;
  }
  if (count === 0 || average === undefined) {
    return (
      <p className={`text-sm text-muted-foreground ${className}`}>
        No ratings yet
      </p>
    );
  }
  return (
    <p className={`flex items-center gap-1 text-sm ${className}`}>
      <span className="font-semibold">{average.toFixed(1)}</span>
      <Star
        className="size-4 fill-amber-400 text-amber-400"
        aria-hidden="true"
      />
      <span className="text-muted-foreground">
        ({count} {count === 1 ? 'rating' : 'ratings'})
      </span>
    </p>
  );
}
