/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { usePublicMediaUrl } from '@discava/common-web-utils/public-media-url';
import { highlightTitle } from '../lib/title-highlight';

// The parts of a title, each keyed by where it starts.
const titleParts = (title: string, typed: string) => {
  let offset = 0;
  return highlightTitle(title, typed).map((part) => {
    const keyed = { ...part, key: offset };
    offset += part.text.length;
    return keyed;
  });
};

// The id of the option at `index`, which the box points aria-activedescendant at.
export const suggestionOptionId = (listId: string, index: number) =>
  `${listId}-option-${index}`;

type Suggestion = { courseId: string; title: string; imageKey?: string };

/**
 * The course suggestions under the top bar's search box: a thumbnail and the
 * title, with the typed start of each word in bold. Choosing a row reports its
 * course; the box owns when the list is open. The last row, "See all results",
 * opens the full results page, and is the row at index `items.length`.
 */
export function SiteSearchSuggestions({
  items,
  typed,
  loading,
  id,
  activeIndex,
  onChoose,
  onSeeAll,
}: {
  items: Suggestion[];
  typed: string;
  loading: boolean;
  id: string;
  activeIndex: number;
  onChoose: (courseId: string) => void;
  onSeeAll: () => void;
}) {
  const mediaUrl = usePublicMediaUrl();
  return (
    <div
      data-testid="site-search-suggestions"
      className="fixed inset-x-4 top-16 z-50 mt-2 overflow-hidden sm:absolute sm:inset-x-0 sm:top-full rounded-xl border bg-popover text-popover-foreground shadow-md"
    >
      {items.length === 0 && loading ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p>
      ) : (
        <>
          {items.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              No courses match
            </p>
          )}
          <ul
            id={id}
            role="listbox"
            aria-label="Course suggestions"
            className="py-1"
          >
            {items.map((item, index) => {
              const src = mediaUrl(item.imageKey);
              return (
                <li
                  key={item.courseId}
                  id={suggestionOptionId(id, index)}
                  role="option"
                  aria-label={item.title}
                  aria-selected={index === activeIndex}
                  className={`flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted ${index === activeIndex ? 'bg-muted' : ''}`}
                  // Keeps focus in the box: a blur would close the list
                  // before the click lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onChoose(item.courseId)}
                >
                  {src ? (
                    <img
                      src={src}
                      alt=""
                      width={64}
                      height={36}
                      loading="lazy"
                      className="aspect-video w-16 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="aspect-video w-16 shrink-0 rounded bg-muted"
                    />
                  )}
                  <span className="min-w-0 flex-1 line-clamp-2 break-words">
                    {titleParts(item.title, typed).map(
                      ({ key, text, match }) =>
                        match ? (
                          <mark
                            key={key}
                            className="bg-transparent font-semibold text-inherit"
                          >
                            {text}
                          </mark>
                        ) : (
                          <span key={key}>{text}</span>
                        ),
                    )}
                  </span>
                </li>
              );
            })}
            <li
              id={suggestionOptionId(id, items.length)}
              role="option"
              aria-selected={activeIndex === items.length}
              className={`w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-muted ${activeIndex === items.length ? 'bg-muted' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onSeeAll}
            >
              {`See all results for ‘${typed}’`}
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
