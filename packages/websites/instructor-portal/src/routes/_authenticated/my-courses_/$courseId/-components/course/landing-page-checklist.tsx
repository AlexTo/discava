/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Link } from '@tanstack/react-router';

interface Line {
  label: string;
  // Undefined while its data loads (only the profile line); shown as "Checking…".
  done?: boolean;
  // The id of the section on this page that fixes it, or the profile page.
  hash?: string;
  to?: '/profile';
}

const LINK_CLASS =
  'font-medium text-primary underline-offset-4 hover:underline';

/**
 * Five things that make the public page persuasive, each ticked or not and
 * linking to where it's fixed. It only informs: Publish is never disabled by it.
 */
export function LandingPageChecklist({
  publicPageUrl,
  hasOutcomes,
  hasRequirements,
  hasPreview,
  hasImage,
  hasProfile,
}: {
  /** The public page's address; given only while the course is published. */
  publicPageUrl?: string;
  hasOutcomes: boolean;
  hasRequirements: boolean;
  /** The preview video is ready to play. */
  hasPreview: boolean;
  hasImage: boolean;
  /** The instructor's profile has a headline and a photo; undefined until it has loaded. */
  hasProfile?: boolean;
}) {
  const lines: Line[] = [
    {
      label: 'Learning outcomes',
      done: hasOutcomes,
      hash: 'landing-page',
    },
    {
      label: 'Requirements',
      done: hasRequirements,
      hash: 'landing-page',
    },
    { label: 'Preview video', done: hasPreview, hash: 'preview-video' },
    { label: 'Course image', done: hasImage, hash: 'course-image' },
    {
      label: 'Your profile (headline and photo)',
      done: hasProfile,
      to: '/profile',
    },
  ];

  return (
    <div className="space-y-3">
      <ul className="space-y-2 text-sm">
        {lines.map(({ label, done, hash, to }) => (
          <li key={label} className="flex flex-wrap items-center gap-2">
            {done === undefined ? (
              <>
                <span aria-hidden="true">–</span>
                <span>{label}</span>
                <span className="text-muted-foreground">Checking…</span>
              </>
            ) : (
              <>
                <span aria-hidden="true">{done ? '✓' : '○'}</span>
                <span>{label}</span>
                <span className="text-muted-foreground">
                  {done ? 'Done' : 'Not yet'}
                </span>
                {!done && to && (
                  <Link
                    to={to}
                    aria-label={`Add it: ${label}`}
                    className={LINK_CLASS}
                  >
                    Add it
                  </Link>
                )}
                {!done && hash && (
                  <Link
                    to="."
                    hash={hash}
                    aria-label={`Add it: ${label}`}
                    className={LINK_CLASS}
                  >
                    Add it
                  </Link>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {publicPageUrl && (
        <a
          href={publicPageUrl}
          target="_blank"
          rel="noreferrer"
          className={LINK_CLASS}
        >
          View public page
        </a>
      )}
    </div>
  );
}
