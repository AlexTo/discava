/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { posix } from 'node:path';
import { ARCHIVE_FOLDER } from './issue.js';
import { scanLines } from './tasks.js';

// What moving a finished spec from specs/<folder>/ to specs/_archive/<folder>/
// changes, as pure functions over file text. archive-specs.ts does the move.

/** Every task in tasks.md is ticked, the ones marked (human) too. */
export const isFinished = (tasksMd: string): boolean => {
  const tasks = scanLines(tasksMd).filter((line) => line.kind === 'task');
  return tasks.length > 0 && tasks.every((task) => task.done);
};

export const livePath = (folder: string): string => `specs/${folder}`;
export const archivedPath = (folder: string): string =>
  `specs/${ARCHIVE_FOLDER}/${folder}`;

const MARKDOWN = /\.mdx?$/;
// A Markdown link's target: `[text](target)` or `[text](target "title")`.
const LINK = /(\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g;
// Not rewritten: URLs (any scheme), in-page anchors and root-relative paths.
const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;

const isInside = (path: string, dir: string): boolean =>
  path === dir || path.startsWith(`${dir}/`);

/**
 * A repo-relative path as it is after the move: under specs/_archive/ if it
 * was in the spec's folder, else unchanged.
 */
export const movedPath = (path: string, folder: string): string =>
  isInside(path, livePath(folder))
    ? archivedPath(folder) + path.slice(livePath(folder).length)
    : path;

/**
 * A Markdown file's relative links, fixed for the move: links from outside
 * the folder into it, and links from inside it to anything outside (which
 * need one more `../`). `file` is the file's repo-relative path before the
 * move. Links within the folder, and everything that isn't a relative link,
 * are left as written.
 */
export const rewriteRelativeLinks = (
  text: string,
  file: string,
  folder: string,
): string => {
  const fromDir = posix.dirname(file);
  const newFromDir = posix.dirname(movedPath(file, folder));
  const fileMoves = isInside(file, livePath(folder));
  return text.replace(LINK, (whole, open: string, target: string, close) => {
    if (NOT_RELATIVE.test(target)) {
      return whole;
    }
    const cut = target.search(/[#?]/);
    const path = cut < 0 ? target : target.slice(0, cut);
    const suffix = cut < 0 ? '' : target.slice(cut);
    if (path === '') {
      return whole;
    }
    const resolved = posix.join(fromDir, path);
    const targetMoves = isInside(resolved, livePath(folder));
    // Both move, or neither does: the link still reads the same.
    if (fileMoves === targetMoves) {
      return whole;
    }
    const trailingSlash = path.endsWith('/') ? '/' : '';
    const relative = posix.relative(newFromDir, movedPath(resolved, folder));
    return `${open}${relative}${trailingSlash}${suffix}${close}`;
  });
};

/**
 * Plain mentions of the spec's path (in code comments, GitHub URLs, prose),
 * pointed at the archive. A mention split across two lines is not found.
 */
export const rewriteMentions = (text: string, folder: string): string =>
  text.replaceAll(`${livePath(folder)}/`, `${archivedPath(folder)}/`);

/** A file's text as it should read once `folder` is archived. */
export const rewriteForArchive = (
  text: string,
  file: string,
  folder: string,
): string =>
  rewriteMentions(
    MARKDOWN.test(file) ? rewriteRelativeLinks(text, file, folder) : text,
    folder,
  );
