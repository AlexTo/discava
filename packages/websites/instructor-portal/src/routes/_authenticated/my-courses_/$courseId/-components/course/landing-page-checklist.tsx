/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

interface Line {
  label: string;
  // Undefined for a line that can't be checked yet: shown as "Coming soon".
  done?: boolean;
  href?: string;
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
}: {
  /** The public page's address; given only while the course is published. */
  publicPageUrl?: string;
  hasOutcomes: boolean;
  hasRequirements: boolean;
  /** The preview video is ready to play. */
  hasPreview: boolean;
  hasImage: boolean;
}) {
  const lines: Line[] = [
    {
      label: 'Learning outcomes',
      done: hasOutcomes,
      href: '#landing-page-heading',
    },
    {
      label: 'Requirements',
      done: hasRequirements,
      href: '#landing-page-heading',
    },
    { label: 'Preview video', done: hasPreview, href: '#landing-page-heading' },
    { label: 'Course image', done: hasImage, href: '#course-image' },
    // Unchecked: instructors can't edit their profile in the portal yet.
    { label: 'Your profile (headline and photo)' },
  ];

  return (
    <div className="space-y-3">
      <ul className="space-y-2 text-sm">
        {lines.map(({ label, done, href }) => (
          <li key={label} className="flex flex-wrap items-center gap-2">
            {done === undefined ? (
              <>
                <span aria-hidden="true">–</span>
                <span>{label}</span>
                <span className="text-muted-foreground">Coming soon</span>
              </>
            ) : (
              <>
                <span aria-hidden="true">{done ? '✓' : '○'}</span>
                <span>{label}</span>
                <span className="text-muted-foreground">
                  {done ? 'Done' : 'Not yet'}
                </span>
                {!done && href && (
                  <a href={href} className={LINK_CLASS}>
                    Add it
                  </a>
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
