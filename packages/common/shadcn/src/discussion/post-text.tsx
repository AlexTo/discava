/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// A post's text as text: line breaks kept, long words wrapped, never HTML.
export function PostText({
  children,
  className = '',
}: {
  children: string;
  className?: string;
}) {
  return (
    <p
      className={`whitespace-pre-line break-words text-sm ${className}`.trim()}
    >
      {children}
    </p>
  );
}
